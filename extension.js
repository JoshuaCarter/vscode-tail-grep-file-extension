'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const DEFAULT_LINE_LIMIT = 10000;
const MIN_LINE_LIMIT = 1;
const MAX_LINE_LIMIT = 200000;
const CHUNK_SIZE = 64 * 1024;
const POLL_INTERVAL_MS = 300;

/** @type {Map<string, TailSession>} */
const sessionsByPath = new Map();

const VIEW_TYPE = 'tailGrepViewer.view';

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('tailGrepViewer.open', async (uriArg) => {
      const uri = await resolveTargetUri(uriArg);
      if (!uri) {
        return;
      }
      // vscode.openWith opens the real file resource with an alternate viewer
      // (the same mechanism any other custom editor uses), instead of a detached
      // webview panel that has no resource of its own. That's what makes the
      // resulting tab draggable elsewhere (e.g. into chat) exactly like the
      // underlying file would be, and it reveals the existing tab instead of
      // duplicating it if that file is already open in this viewer.
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    })
  );

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new TailEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false
    })
  );
}

function deactivate() {
  for (const session of sessionsByPath.values()) {
    session.dispose();
  }
  sessionsByPath.clear();
}

async function resolveTargetUri(uriArg) {
  if (uriArg && uriArg.fsPath) {
    return uriArg;
  }
  const active = vscode.window.activeTextEditor;
  if (active && active.document.uri.scheme === 'file') {
    return active.document.uri;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Open in Tail + Grep Viewer'
  });
  return picked && picked[0];
}

class TailEditorProvider {
  constructor(context) {
    this.context = context;
    // Required by the CustomEditorProvider interface even for a read-only viewer
    // that never edits its document; this emitter simply never fires.
    this._onDidChangeCustomDocument = new vscode.EventEmitter();
    this.onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
  }

  async openCustomDocument(uri) {
    return { uri, dispose() {} };
  }

  async resolveCustomEditor(document, webviewPanel) {
    const filePath = document.uri.fsPath;
    const session = new TailSession(this.context, filePath, { panel: webviewPanel });
    sessionsByPath.set(filePath, session);
    webviewPanel.onDidDispose(() => {
      session.dispose();
      sessionsByPath.delete(filePath);
    });
  }
}

class TailSession {
  constructor(context, filePath, options) {
    this.context = context;
    this.filePath = filePath;
    this.lineLimit = DEFAULT_LINE_LIMIT;
    this.lines = [];
    this.offset = 0;
    this.partial = '';
    this.pollTimer = null;
    this.disposed = false;
    // Absolute (1-based) line number of this.lines[0] within the file on disk,
    // so the gutter can show/jump to real file line numbers even though only
    // a tail window of the file is held in memory.
    this.startLineNumber = 1;

    this.panel = options.panel;
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    };

    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
  }

  getHtml() {
    const webview = this.panel.webview;
    const mediaUri = (name) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name)).toString();
    const nonce = `${Date.now()}${Math.random().toString(36).slice(2)}`;
    const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.html').fsPath;
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html
      .replace(/__CSS_URI__/g, mediaUri('webview.css'))
      .replace(/__JS_URI__/g, mediaUri('webview.js'))
      .replace(/__CSP_SOURCE__/g, webview.cspSource)
      .replace(/__NONCE__/g, nonce)
      .replace(/__FILE_PATH__/g, escapeHtml(this.filePath))
      .replace(/__LINE_LIMIT__/g, String(this.lineLimit));
    return html;
  }

  async handleMessage(msg) {
    switch (msg.type) {
      case 'ready':
        await this.loadInitial();
        this.startPolling();
        break;
      case 'setLineLimit':
        await this.setLineLimit(msg.value);
        break;
      case 'clear':
        await this.clearFile();
        break;
      case 'refresh':
        await this.loadInitial();
        break;
      case 'gotoLine':
        await this.goToLine(msg.line);
        break;
      default:
        break;
    }
  }

  async loadInitial() {
    try {
      const { lines, size, startLine } = readTailLines(this.filePath, this.lineLimit);
      this.lines = lines;
      this.offset = size;
      this.partial = '';
      this.startLineNumber = startLine;
      this.post({
        type: 'init',
        filePath: this.filePath,
        lineLimit: this.lineLimit,
        lines: this.lines,
        startLine: this.startLineNumber
      });
    } catch (err) {
      this.post({ type: 'error', message: `Failed to read file: ${err.message}` });
    }
  }

  // Opens the underlying file in a normal (non-tail) text editor beside this
  // viewer and jumps straight to the requested line, so clicking a line number
  // in the gutter behaves like a "go to definition" for that spot in the file.
  async goToLine(lineNumber) {
    try {
      const doc = await vscode.workspace.openTextDocument(this.filePath);
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false
      });
      const zeroBased = Math.min(Math.max(0, lineNumber - 1), Math.max(0, doc.lineCount - 1));
      const range = doc.lineAt(zeroBased).range;
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch (err) {
      this.post({ type: 'error', message: `Failed to open line ${lineNumber}: ${err.message}` });
    }
  }

  startPolling() {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  async poll() {
    if (this.disposed) {
      return;
    }
    let stat;
    try {
      stat = fs.statSync(this.filePath);
    } catch (err) {
      return;
    }

    if (stat.size < this.offset) {
      this.offset = 0;
      this.lines = [];
      this.partial = '';
      this.startLineNumber = 1;
      if (stat.size === 0) {
        this.post({ type: 'update', lines: [], startLine: this.startLineNumber });
        return;
      }
      await this.loadInitial();
      return;
    }

    if (stat.size === this.offset) {
      return;
    }

    let fd;
    try {
      fd = fs.openSync(this.filePath, 'r');
      const readSize = stat.size - this.offset;
      const buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, this.offset);
      this.offset = stat.size;
      const text = this.partial + buffer.toString('utf8');
      const parts = text.split(/\r\n|\r|\n/);
      this.partial = parts.pop() || '';
      if (parts.length > 0) {
        this.lines.push(...parts);
        if (this.lines.length > this.lineLimit) {
          const overflow = this.lines.length - this.lineLimit;
          this.lines = this.lines.slice(overflow);
          this.startLineNumber += overflow;
        }
        this.post({ type: 'update', lines: this.lines, startLine: this.startLineNumber });
      }
    } catch (err) {
      // Transient read errors (e.g. writer briefly locking the file) are ignored; next poll retries.
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
      }
    }
  }

  async setLineLimit(value) {
    const n = normalizeLineLimit(value);
    this.lineLimit = n;
    if (this.lines.length > n) {
      const overflow = this.lines.length - n;
      this.lines = this.lines.slice(overflow);
      this.startLineNumber += overflow;
      this.post({ type: 'update', lines: this.lines, startLine: this.startLineNumber });
    } else {
      await this.loadInitial();
    }
  }

  async clearFile() {
    try {
      wipeLogFileSafely(this.filePath);
      this.offset = 0;
      this.lines = [];
      this.partial = '';
      this.startLineNumber = 1;
      this.post({ type: 'update', lines: [], startLine: this.startLineNumber });
      this.post({
        type: 'info',
        message: 'File wiped (rotated safely; any process still writing keeps the old file).'
      });
    } catch (err) {
      this.post({ type: 'error', message: `Failed to clear file: ${err.message}` });
    }
  }

  post(msg) {
    if (!this.disposed) {
      this.panel.webview.postMessage(msg);
    }
  }

  dispose() {
    this.disposed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

function readTailLines(filePath, numLines) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const fileSize = stat.size;
    if (fileSize === 0) {
      return { lines: [], size: 0, startLine: 1 };
    }

    let position = fileSize;
    let newlineCount = 0;
    const chunks = [];

    while (position > 0 && newlineCount <= numLines) {
      const readSize = Math.min(CHUNK_SIZE, position);
      position -= readSize;
      const buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, position);
      chunks.unshift(buffer);
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] === 10 /* \n */) {
          newlineCount++;
        }
      }
    }

    // If the backward scan reached byte 0, the buffer we just read *is* the
    // whole file, so its parsed line count doubles as the file's true total
    // line count without any extra work. Otherwise there's more file above
    // what we scanned, so a separate lightweight full-file pass is needed to
    // know how many lines precede our window (only costs one linear byte scan,
    // no line storage).
    const reachedStartOfFile = position === 0;

    const text = Buffer.concat(chunks).toString('utf8');
    let lines = text.split(/\r\n|\r|\n/);
    if (lines.length && lines[lines.length - 1] === '') {
      lines.pop();
    }
    const scannedLineCount = lines.length;
    if (lines.length > numLines) {
      lines = lines.slice(lines.length - numLines);
    }

    const totalLines = reachedStartOfFile ? scannedLineCount : countFileLines(filePath, fd);
    const startLine = Math.max(1, totalLines - lines.length + 1);

    return { lines, size: fileSize, startLine };
  } finally {
    fs.closeSync(fd);
  }
}

// Counts total lines in a file with O(1) memory by streaming through it and
// only tallying newline bytes, never holding the full contents at once.
function countFileLines(filePath, existingFd) {
  const fd = existingFd !== undefined ? existingFd : fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const size = stat.size;
    if (size === 0) {
      return 0;
    }
    const buffer = Buffer.alloc(CHUNK_SIZE);
    let position = 0;
    let count = 0;
    let sawAnyByte = false;
    let lastByteWasNewline = false;
    while (position < size) {
      const readSize = Math.min(CHUNK_SIZE, size - position);
      fs.readSync(fd, buffer, 0, readSize, position);
      for (let i = 0; i < readSize; i++) {
        sawAnyByte = true;
        if (buffer[i] === 10 /* \n */) {
          count++;
          lastByteWasNewline = true;
        } else {
          lastByteWasNewline = false;
        }
      }
      position += readSize;
    }
    if (sawAnyByte && !lastByteWasNewline) {
      count++;
    }
    return count;
  } finally {
    if (existingFd === undefined) {
      fs.closeSync(fd);
    }
  }
}

function normalizeLineLimit(value) {
  return Math.max(MIN_LINE_LIMIT, Math.min(MAX_LINE_LIMIT, Math.floor(Number(value)) || DEFAULT_LINE_LIMIT));
}

// Clears a log file without fighting an active appender. Truncating in place (ftruncate)
// while another process still has the file open for append is unsafe on Windows: the
// writer keeps its old byte offset and can write past the new EOF, producing sparse or
// garbage data that editors then reject as binary. Instead we rotate like logrotate:
// rename the current file away (the writer's open handle stays on that inode and keeps
// appending there harmlessly), then create a brand-new empty file at the original path
// for this viewer and any new openers to use.
function wipeLogFileSafely(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const rotatedPath = path.join(dir, `${base}.${Date.now()}.wiped`);

  try {
    fs.renameSync(filePath, rotatedPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  fs.writeFileSync(filePath, '');

  // Best-effort cleanup of the rotated backup. This usually fails on Windows while the
  // original writer still holds the old file open, which is fine — leave it on disk.
  try {
    fs.unlinkSync(rotatedPath);
  } catch (_) {}
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

module.exports = { activate, deactivate };

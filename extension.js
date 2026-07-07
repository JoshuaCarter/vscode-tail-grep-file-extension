'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const DEFAULT_LINE_LIMIT = 2000;
const MIN_LINE_LIMIT = 1;
const MAX_LINE_LIMIT = 200000;
const CHUNK_SIZE = 64 * 1024;
const POLL_INTERVAL_MS = 300;

/** @type {Map<string, TailSession>} */
const sessionsByPath = new Map();

const VIEW_TYPE = 'tailGrepViewer';

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('tailGrepViewer.open', async (uriArg) => {
      const uri = await resolveTargetUri(uriArg);
      if (!uri) {
        return;
      }
      openOrRevealSession(context, uri.fsPath);
    })
  );

  // Lets a panel that was open when the window/editor was closed come back
  // automatically on the next launch, restored with the same file, line
  // limit, and filter (persisted via the webview's own setState/getState).
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(webviewPanel, state) {
        const filePath = state && state.filePath;
        if (!filePath || !fs.existsSync(filePath)) {
          webviewPanel.webview.options = { enableScripts: false };
          webviewPanel.webview.html = `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-descriptionForeground);">File no longer available${
            filePath ? `: <code>${escapeHtml(filePath)}</code>` : ''
          }.</body></html>`;
          return;
        }
        if (sessionsByPath.has(filePath)) {
          webviewPanel.dispose();
          return;
        }
        const session = new TailSession(context, filePath, {
          panel: webviewPanel,
          lineLimit: state.lineLimit
        });
        sessionsByPath.set(filePath, session);
        session.panel.onDidDispose(() => {
          session.dispose();
          sessionsByPath.delete(filePath);
        });
      }
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

function openOrRevealSession(context, filePath) {
  const existing = sessionsByPath.get(filePath);
  if (existing) {
    existing.panel.reveal(vscode.ViewColumn.Active);
    return;
  }
  const session = new TailSession(context, filePath);
  sessionsByPath.set(filePath, session);
  session.panel.onDidDispose(() => {
    session.dispose();
    sessionsByPath.delete(filePath);
  });
}

class TailSession {
  constructor(context, filePath, options = {}) {
    this.context = context;
    this.filePath = filePath;
    this.lineLimit = normalizeLineLimit(options.lineLimit);
    this.lines = [];
    this.offset = 0;
    this.partial = '';
    this.pollTimer = null;
    this.disposed = false;

    const webviewOptions = {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    };

    this.panel =
      options.panel ||
      vscode.window.createWebviewPanel(VIEW_TYPE, `Tail: ${path.basename(filePath)}`, vscode.ViewColumn.Active, webviewOptions);

    // Restored panels come back with no options set, so they need to be applied explicitly.
    this.panel.webview.options = webviewOptions;
    this.panel.title = `Tail: ${path.basename(filePath)}`;

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
      default:
        break;
    }
  }

  async loadInitial() {
    try {
      const { lines, size } = readTailLines(this.filePath, this.lineLimit);
      this.lines = lines;
      this.offset = size;
      this.partial = '';
      this.post({ type: 'init', filePath: this.filePath, lineLimit: this.lineLimit, lines: this.lines });
    } catch (err) {
      this.post({ type: 'error', message: `Failed to read file: ${err.message}` });
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
      if (stat.size === 0) {
        this.post({ type: 'update', lines: [] });
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
          this.lines = this.lines.slice(this.lines.length - this.lineLimit);
        }
        this.post({ type: 'update', lines: this.lines });
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
      this.lines = this.lines.slice(this.lines.length - n);
      this.post({ type: 'update', lines: this.lines });
    } else {
      await this.loadInitial();
    }
  }

  async clearFile() {
    try {
      // Low-level truncate-in-place: a single ftruncate syscall on the existing file handle/inode,
      // with no read-modify-write step. This avoids delete+recreate races with any process that
      // still holds the file open for appending, and fsync flushes the new (zero) length to disk
      // immediately so there is no window where the file is left in a half-written state.
      const fd = fs.openSync(this.filePath, 'r+');
      try {
        fs.ftruncateSync(fd, 0);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      this.offset = 0;
      this.lines = [];
      this.partial = '';
      this.post({ type: 'update', lines: [] });
      this.post({ type: 'info', message: 'File contents wiped (truncated to 0 bytes).' });
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
      return { lines: [], size: 0 };
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

    const text = Buffer.concat(chunks).toString('utf8');
    let lines = text.split(/\r\n|\r|\n/);
    if (lines.length && lines[lines.length - 1] === '') {
      lines.pop();
    }
    if (lines.length > numLines) {
      lines = lines.slice(lines.length - numLines);
    }
    return { lines, size: fileSize };
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeLineLimit(value) {
  return Math.max(MIN_LINE_LIMIT, Math.min(MAX_LINE_LIMIT, Math.floor(Number(value)) || DEFAULT_LINE_LIMIT));
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

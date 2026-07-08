# Grail (tail and grep)

Tail any file in an editor window, filter lines with ease, wipe the log with a single click.

## Usage

1. Right-click a file (Explorer, editor tab, or inside an open file) → **Grail: Open File**.
2. Type in the filter bar to narrow down lines — plain text or `/regex/flags`.
3. Adjust **Lines** to change how many lines are kept.
4. Click **Wipe File Contents** to clear the log. Tries ReplaceFile / delete-on-close /
   rename on Windows (unlink on Unix). If the log writer holds an exclusive lock,
   the viewer clears from the current end instead — new lines still stream in.
5. Click the (subtle, grey) line number next to any log line to open the real file at that
   exact line in a normal editor, next to the viewer.

The viewer tab is bound to the real file on disk, so you can drag its tab into chat (or
anywhere else you'd drop a file) and it behaves exactly like dropping the file itself. The
filter, regex/case toggles, and line limit are remembered per file across reloads.

## Installation

**From the marketplace** (VS Code or Cursor): search for **Grail (tail and grep)** by joshuacarter.

**From GitHub Releases:** download `grail-<version>.vsix`, then in VS Code or Cursor run
**Extensions: Install from VSIX…** and select the file.

**Manual / dev install:** copy this folder into your extensions directory as `joshuacarter.grail/`, then reload the window:

- Cursor: `~/.cursor/extensions/joshuacarter.grail/`
- VS Code: `~/.vscode/extensions/joshuacarter.grail/`

## Releases (maintainers)

Pushing a version tag builds a `.vsix` and attaches it to a GitHub Release automatically
(see `.github/workflows/release.yml`).

1. Bump `"version"` in `package.json`.
2. Commit, then tag and push:
   ```bash
   git tag v1.0.0
   git push origin main --tags
   ```
3. The workflow produces `grail-1.0.0.vsix` on the [Releases](https://github.com/JoshuaCarter/vscode-tail-grep-file-extension/releases) page.

You can also trigger a release build manually from the **Actions** tab (**Release** → **Run workflow**).

## Marketplace publish (optional)

```bash
npm install -g @vscode/vsce
vsce login joshuacarter
vsce package    # local test: grail-1.0.0.vsix
vsce publish
```

## License

MIT

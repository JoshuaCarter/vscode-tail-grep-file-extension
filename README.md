# Grail (tail and grep)

Tail any file in an editor window, filter lines with ease, wipe the log with a single click.

![Grail — tail, filter, and live follow](https://raw.githubusercontent.com/JoshuaCarter/vscode-grail-extension/main/images/grail.gif)

## Usage

1. Right-click a file (Explorer, editor tab, or inside an open file) → **Grail: Open File**.
   Grail opens in its own tab, separate from the normal text editor — you can have both
   open for the same file at the same time. Double-clicking a file in Explorer still opens
   it in the regular editor.
2. Use the **file link at the top** of the Grail panel to open the source file, or drag it
   into chat as file context (same as dragging from Explorer when supported).
3. Type in the filter bar to narrow down lines — plain text or `/regex/flags`.
4. Adjust **Lines** to change how many lines are kept.
5. Click **Wipe File Contents** to clear the log. Tries ReplaceFile / delete-on-close /
   rename on Windows (unlink on Unix). If the log writer holds an exclusive lock,
   the viewer clears from the current end instead — new lines still stream in.
6. Click the (subtle, grey) line number next to any log line to open the real file at that
   exact line in a normal editor beside the viewer.

The filter, regex/case toggles, and line limit are remembered per file across reloads.

## Installation

**From the marketplace** (VS Code or Cursor): search for **Grail (tail and grep)** by joshuacarter.

**From GitHub Releases:** download `grail-<version>.vsix`, then in VS Code or Cursor run
**Extensions: Install from VSIX…** and select the file.

**Manual / dev install:** copy this folder into your extensions directory as `joshuacarter.grail/`, then reload the window:

- Cursor: `~/.cursor/extensions/joshuacarter.grail/`
- VS Code: `~/.vscode/extensions/joshuacarter.grail/`

## Releases (maintainers)

Every push to `main` auto-bumps the patch version, packages a `.vsix`, and publishes a
GitHub Release (see `.github/workflows/release.yml`). Version bumps are committed back
with `[skip ci]` so the workflow does not loop.

1. Commit and push to `main` — that's it.
2. The workflow increments the latest `v*` tag (e.g. `v1.0.0` → `v1.0.1`) and attaches
   `grail-<version>.vsix` to the [Releases](https://github.com/JoshuaCarter/vscode-grail-extension/releases) page.

You can also trigger a release manually from the **Actions** tab (**Release** → **Run workflow**).

## Marketplace publish (optional)

```bash
npm install -g @vscode/vsce
vsce login joshuacarter
vsce package    # local test: grail-1.0.0.vsix
vsce publish
```

## License

MIT

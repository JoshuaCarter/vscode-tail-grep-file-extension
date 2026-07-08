# Tail + Grep Viewer

Makes watching simple log files a joy. Tail any file in an editor window, filter lines
with ease, wipe the file with a single click.

## Usage

1. Right-click a file (Explorer, editor tab, or inside an open file) → **Tail + Grep: Open File**.
2. Type in the filter bar to narrow down lines — plain text or `/regex/flags`.
3. Adjust **Lines** to change how many lines are kept.
4. Click **Wipe File Contents** to instantly clear the log. This rotates the file
   safely (rename away + create a fresh empty file) so any process still writing to the
   old log handle is not disturbed and the path never ends up corrupted.
5. Click the (subtle, grey) line number next to any log line to open the real file at that
   exact line in a normal editor, next to the viewer.

The viewer tab is bound to the real file on disk, so you can drag its tab into chat (or
anywhere else you'd drop a file) and it behaves exactly like dropping the file itself. The
filter, regex/case toggles, and line limit are remembered per file across reloads.

## Installation

Copy this folder into your extensions directory, then reload the window:

- Cursor: `~/.cursor/extensions/`
- VS Code: `~/.vscode/extensions/`

## License

MIT

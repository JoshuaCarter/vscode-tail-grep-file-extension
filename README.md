# Grail (tail & grep)

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

Copy this folder into your extensions directory, then reload the window:

- Cursor: `~/.cursor/extensions/`
- VS Code: `~/.vscode/extensions/`

## License

MIT

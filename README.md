# Tail + Grep Viewer

A read-only, `tail -f`-style viewer for VS Code / Cursor. Opens huge files by loading only
the last *N* lines (default 2000) instead of the whole document, so large or fast-growing
log files never cause editor slowdowns. Includes an inline grep-style filter bar and a
safe, low-level "Clear File" command for wiping log files without risking corruption.

## Features

- **Tail-only loading** — reads backward from the end of the file in chunks to find the
  last *N* lines, without ever reading the whole file into memory. Fast even on
  multi-gigabyte files.
- **Live follow (`tail -f`)** — polls the file for growth and streams new lines in as
  they're written, keeping a rolling buffer capped at the configured line limit (oldest
  lines drop off as new ones arrive).
- **Grep-style filter bar** — type plain text for a literal substring match, or
  `/pattern/flags` for a full regular expression. Toggle regex mode (`.*`) and
  case-sensitivity (`Aa`) independently. Matches are highlighted inline, and the filter
  is re-applied live as new tailed lines stream in — effectively `tail -f file | grep
  pattern` running under the hood, with the same line-limit cap.
- **Follow / jump-to-bottom** — auto-scrolls while you're at the bottom; scrolling up
  pauses auto-scroll and shows a "Jump to bottom ↓" button.
- **Safe low-level Clear File** — truncates the file on disk to 0 bytes via a single
  `ftruncate` syscall on the existing file handle (plus `fsync`), instead of a
  read-modify-write or delete+recreate. This means a process still holding the file open
  for appending just keeps writing from the new (zero) end, with no window where the file
  is left partially written — the same technique used by tools like `logrotate
  --copytruncate` or `: > file`.
- **Read-only** — this is a viewer, not an editor, so there's no risk of accidentally
  modifying a live log file.

## Usage

1. Right-click a file in the Explorer, right-click an editor tab, or right-click inside
   an open file, and choose **Tail + Grep: Open File** — or run it from the Command
   Palette against the active file.
2. Use the filter bar at the top to narrow down lines.
3. Adjust the **Lines** box to change the rolling buffer size (raising it re-reads more
   history from disk; lowering it trims the in-memory buffer).
4. Use **Clear File** to truncate the underlying file (with a confirmation prompt).

## Installation (local/unpacked)

This extension ships unpacked (no build step — plain JavaScript). To install locally:

1. Copy this folder into your editor's extensions directory:
   - Cursor: `%USERPROFILE%\.cursor\extensions\` (Windows) or `~/.cursor/extensions/`
     (macOS/Linux)
   - VS Code: `%USERPROFILE%\.vscode\extensions\` (Windows) or `~/.vscode/extensions/`
     (macOS/Linux)
2. Reload the window (**Developer: Reload Window**).

## How it works

- `extension.js` implements the tail-read algorithm (seek from EOF, read backward in 64KB
  chunks counting newlines), a poll-based live-follow loop, and the truncate-based clear
  command, and hosts a webview panel per open file.
- `media/webview.{html,css,js}` implement the UI: the filter bar, match highlighting,
  auto-scroll/follow behavior, and messaging back to the extension host.

## License

MIT

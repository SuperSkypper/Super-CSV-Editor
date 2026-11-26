# Changelog - v0.0.4

## Bug fixes

- Auto-fit columns now measure cell values only instead of column headers, preventing values with emoji or wider glyphs from being truncated when their estimated width ties with or is narrower than the header.

## Review & compatibility fixes

- Implemented `getSettingDefinitions()` on `SuperCsvSettingTab` so plugin settings appear in Obsidian's global settings search on Obsidian 1.13.0+ (while keeping `display()` as a fallback for older versions).

# Changelog - v0.0.3

## Features

- Added **Columns** settings: **Auto-fit columns** toggle, **Minimum column width**, and **Maximum column width** (with live updates when finishing input).

## Performance & memory

- Filtering now toggles row visibility in place instead of rebuilding the table DOM on every keystroke.
- Replaced per-cell, per-link, and per-checkbox event listeners with event delegation on `<tbody>`.
- Incremental selection/focus painting, cached dirty flag, single-column width checks on edit, and debounced link-resolution updates.
- Fixed observer and DOM listener leaks across re-renders and embed unloads.

## Review & compatibility fixes

- Resolved all Obsidian Auto Review lint, API compatibility, CSS, TypeScript strictness, and `moment` dependency warnings.

# Changelog - v0.0.2

## Features

- Added **Search on this column** to the column header context menu to filter (and replace) within a single column, with a removable column badge in the search bar.

## Bug fixes

- Batch copy, cut, paste, clear, fill (`Ctrl+D` / `Ctrl+R`), selection, and row deletion now operate only on visible rows when a search filter is active, leaving filtered-out rows untouched.
- Multi-cell paste now anchors at the top-left of the visible selection rather than the focus corner.

# Changelog - v0.0.1

## First release

- Opens `.csv` files in a grid view instead of the raw text editor.
- Inline cell editing with keyboard navigation: **Enter**, **Shift+Enter**,
  **Tab**, **Shift+Tab** and **Escape**.
- Add, delete and reorder rows and columns; rename a column from its header.
- Inline CSV embeds: `![[file.csv]]` renders the same grid inside a note.
- Undo and redo for structural and cell edits.
- Delimiter detected per file (`,` `;` tab `|`), with an optional manual
  override in settings.
- Saving preserves delimiters, line endings and quoting instead of rewriting
  the whole file, and rows whose width differs from the header are kept as-is.

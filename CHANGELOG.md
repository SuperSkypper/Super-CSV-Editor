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

# 🧮 Super CSV Editor

An Obsidian plugin that opens `.csv` files as an editable spreadsheet grid
instead of raw text.

## ✨ Features

**📊 Grid view**
- Any `.csv` file opens in a grid with a sticky header row.
- Rows whose column count differs from the header are highlighted as *ragged*
  and never truncated.

**✏️ Editing**
- Double-click a cell, or run **Edit cell**, to edit inline.
  - **Enter** commits and moves down, **Ctrl/Cmd+Enter** commits in place.
  - **Tab** / **Shift+Tab** commit and move to the next or previous cell,
    wrapping across rows.
  - **Shift+Enter** inserts a newline inside the cell.
  - **Escape** cancels the edit.
- Undo and redo cover cell and structural edits.

**🧱 Rows and columns**
- Add, delete and reorder rows and columns.
- Double-click a header to rename the column.

**🖼️ Embeds**
- `![[file.csv]]` renders the same grid inside a note.
- Optional add-row / add-column strips and a status readout inside embeds, so a
  note can keep looking like a plain table.

**💾 Fidelity**
- Delimiter is detected per file (`,` `;` tab `|`), with an optional manual
  override in settings.
- Line endings (LF or CRLF) and a missing trailing newline are preserved, so a
  one-cell edit does not turn into a whole-file diff.
- Fields are quoted only when they must be, and doubled quotes inside a field
  are escaped correctly.

## 📦 Installation

Install **Super CSV Editor** from **Settings → Community plugins** inside
Obsidian.

## ⌨️ Commands

| Command | What it does |
| --- | --- |
| Add row | Inserts a row below the focused row |
| Remove row | Deletes the focused row |
| Add column | Inserts a column after the focused column |
| Remove column | Deletes the focused column |
| Move row up / down | Reorders the focused row |
| Move column left / right | Reorders the focused column |
| Edit cell | Starts inline editing on the focused cell |
| Undo / Redo | Reverts or reapplies an edit |
| Save CSV now | Writes pending edits to the vault immediately |
| Create new CSV | Creates an empty sheet and opens it in the grid |

Commands act on the CSV that is currently active, never on the other open
sheets.

## 🛠️ Development

```bash
npm install
npm run dev       # watch build
npm run build     # type-check and bundle to main.js
npm run lint
npm test
```

Copying the build into a vault's plugin folder for manual testing:

```bash
CSV_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/super-csv-editor" npm run deploy
```

The parser suite also has an optional round-trip test against a real vault:

```bash
VAULT_PATH="/path/to/vault" npm run test:vault
```

## 💬 Support

- [Ko-fi](https://ko-fi.com/superskypper)
- [X / Twitter](https://x.com/SuperSkypper)

## 📄 License

MIT — see [LICENSE](LICENSE).

## Note from the author

I am not a programmer. I built Super CSV Editor because I wanted to edit CSV
files inside Obsidian without leaving the app, and I decided to share it in
case it helps other people too.

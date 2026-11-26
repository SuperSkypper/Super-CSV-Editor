# 🧮 Super CSV Editor

[![Release](https://img.shields.io/github/v/release/SuperSkypper/Super-CSV-Editor)](https://github.com/SuperSkypper/Super-CSV-Editor/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Min App Version](https://img.shields.io/badge/obsidian-1.6.6%2B-7c3aed)](https://obsidian.md)

An Obsidian plugin that opens `.csv` files as an editable spreadsheet grid instead of raw text.

The goal of **Super CSV Editor** is to make `.csv` files feel as close as possible to Obsidian's native experience — with an editable inline title, `[[wikilinks]]` and autocomplete, a backlinks panel, Bases-style live search, embeds (`![[file.csv]]`), and seamless theme integration.

## ✨ Features

**📊 Grid view & Obsidian-native feel**
- Opens any `.csv` file in a clean spreadsheet grid with a sticky header row and row-number gutter.
- Editable inline file title, theme-aware styling, and a links/backlinks panel below the grid.
- Native `[[wikilinks]]` with `[[` note autocomplete and resolved/unresolved link styling (`Ctrl/Cmd+Click` opens the note), plus clickable URLs and Markdown links.
- Renders boolean values (`true` / `false`) as interactive checkboxes.
- Highlights rows whose column count differs from the header as *ragged* without ever truncating data.

**🔍 Search, filter & replace**
- Bases-style live search (**Ctrl/Cmd+F** or the **Search** toolbar button) filters the sheet down to matching rows.
- Right-click any column header and choose **Search on this column** to scope filtering and **Replace all** to that column alone.

**✏️ Editing & clipboard**
- Double-click a cell, press **Enter** / **F2**, or run **Edit cell** to edit inline:
  - **Enter** commits and moves down; **Ctrl/Cmd+Enter** commits in place.
  - **Shift+Enter** moves down and appends a new row at the bottom.
  - **Tab** / **Shift+Tab** commit and move to the next or previous cell, wrapping across rows.
  - **Escape** cancels the edit.
- Multi-cell selection via click-drag, **Shift**, **Ctrl/Cmd**, **Ctrl/Cmd+A**, or clicking row/column headers.
- Copy and cut produce Markdown tables (ready to paste straight into a note); paste accepts both Markdown tables and TSV from Excel or Google Sheets.
- Fill down (**Ctrl/Cmd+D**) and fill right (**Ctrl/Cmd+R**).
- All batch operations (copy, cut, paste, clear, fill, delete) respect the active search filter and leave hidden rows untouched.
- Full undo (**Ctrl/Cmd+Z**) and redo (**Ctrl/Cmd+Y** / **Ctrl/Cmd+Shift+Z**) for cell and structural edits.

**🧱 Rows & columns**
- Add, delete, sort (**A–Z** / **Z–A**), and reorder rows and columns (including drag-and-drop column headers).
- Auto-fit column widths with drag-to-resize handles (double-click the handle to reset).
- Double-click a header to rename the column.

**🖼️ Embeds**
- `![[file.csv]]` renders the same editable grid inside a note, with optional row limits such as `![[file.csv|5]]`.
- Optional add-row / add-column strips and status bar toggles inside embeds, so a note can stay clean like a plain table.

**💾 File fidelity**
- Detects delimiters per file (`,`, `;`, tab, `|`), with an optional manual override in settings.
- Preserves line endings (LF or CRLF), blank lines, short/ragged row widths, and missing trailing newlines, so a one-cell edit never turns into a whole-file diff.
- Quotes fields only when necessary and properly escapes doubled quotes inside a field.

## 📦 Installation

### Community plugins

Install **Super CSV Editor** from **Settings → Community plugins** inside Obsidian.

### Manual

1. Download `manifest.json`, `main.js`, and `styles.css` from the [latest release](https://github.com/SuperSkypper/Super-CSV-Editor/releases/latest).
2. Create the folder `<Vault>/.obsidian/plugins/super-csv-editor/`.
3. Copy the three files into that folder.
4. Reload Obsidian and enable **Super CSV Editor** under **Settings → Community plugins**.

Requires Obsidian **1.6.6** or later. Works on desktop and mobile.

## ⌨️ Commands

| Command | What it does |
| --- | --- |
| Add row | Inserts a row below the focused row |
| Remove row | Deletes the selected or focused row(s) |
| Add column | Inserts a column after the focused column |
| Remove column | Deletes the selected or focused column(s) |
| Move row up / down | Reorders the focused row |
| Move column left / right | Reorders the focused column |
| Edit cell | Starts inline editing on the focused cell |
| Undo / Redo | Reverts or reapplies an edit |
| Save CSV now | Writes pending edits to the vault immediately |
| Create new CSV | Creates an empty sheet and opens it in the grid |

Commands act on the CSV that is currently active, never on other open sheets.

## 🛠️ Development

```bash
npm install
npm run dev       # watch build
npm run build     # type-check and bundle to main.js
npm run lint
npm test
```

Copy the build into a vault's plugin folder for manual testing:

```bash
CSV_PLUGIN_DIR="/path/to/vault/.obsidian/plugins/super-csv-editor" npm run deploy
```

Run the optional parser round-trip test against a real vault:

```bash
VAULT_PATH="/path/to/vault" npm run test:vault
```

## 💬 Support

- [GitHub Issues](https://github.com/SuperSkypper/Super-CSV-Editor/issues) — bug reports and feature requests
- [Ko-fi](https://ko-fi.com/superskypper)
- [X / Twitter](https://x.com/SuperSkypper)

## 📄 License

MIT — see [LICENSE](LICENSE).

## ✍️ Note from the author

I am not a programmer and I use AI to help build this plugin. I created Super CSV Editor because I wanted to work with CSV files inside Obsidian in a way that feels native to the app without having to leave it, and I decided to share it in case it helps other people too.

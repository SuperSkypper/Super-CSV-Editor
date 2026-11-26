import { setCellInPlace, clone, blankRow, reindexRagged } from "../parser/table.ts";
import { columnCount, type CsvTable } from "../parser/csv.ts";
import type { Focus } from "./navigation.ts";

/**
 * Clipboard handling for the grid.
 *
 * The grid speaks the format every spreadsheet already uses: tab-separated
 * columns, newline-separated rows. That is what makes copy/paste interoperate
 * with Obsidian tables, Excel and Google Sheets without a conversion step.
 *
 * Everything here is pure, so the rectangle arithmetic is testable without a DOM.
 */

/** One rectangle of selected cells: rows top..bottom, cols left..right. */
interface Rect {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

function boundsOf(cells: Focus[]): Rect | null {
	if (cells.length === 0) return null;
	let top = Infinity;
	let bottom = -Infinity;
	let left = Infinity;
	let right = -Infinity;
	for (const cell of cells) {
		if (cell.row < top) top = cell.row;
		if (cell.row > bottom) bottom = cell.row;
		if (cell.col < left) left = cell.col;
		if (cell.col > right) right = cell.col;
	}
	return { top, bottom, left, right };
}

function visibleRowsInRect(
	rect: Rect,
	hiddenRows?: ReadonlySet<number>,
): number[] {
	const rows: number[] = [];
	for (let row = rect.top; row <= rect.bottom; row++) {
		if (hiddenRows?.has(row)) continue;
		rows.push(row);
	}
	return rows;
}

/**
 * Renders the selection as TSV.
 *
 * A sparse selection still produces a full rectangle with empty gaps, so the
 * pasted block lines up with the columns it came from instead of shifting left.
 * Rows hidden by an active filter are omitted so copy never leaks filtered-out
 * records into the clipboard.
 */
export function serializeSelection(
	table: CsvTable,
	cells: Focus[],
	hiddenRows?: ReadonlySet<number>,
): string {
	const rect = boundsOf(cells);
	if (!rect) return "";
	const rows = visibleRowsInRect(rect, hiddenRows);
	if (rows.length === 0) return "";
	const lines: string[] = [];
	for (const row of rows) {
		const values: string[] = [];
		for (let col = rect.left; col <= rect.right; col++) {
			values.push(table.rows[row]?.[col] ?? "");
		}
		lines.push(values.join("\t"));
	}
	return lines.join("\n");
}

/** Reads TSV back into a grid of values. */
export function parseClipboardGrid(text: string): string[][] {
	if (!text) return [];
	// A trailing newline ends the last row; it must not invent an empty one.
	const body = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
	if (!body) return [];

	// Rows and columns are split together so a newline inside a quoted value is
	// kept as part of that value instead of starting a new row.
	return splitRowsAndCells(body);
}

/**
 * Walks the text once, honouring quotes, and emits a row per unquoted newline.
 */
function splitRowsAndCells(body: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let inQuotes = false;

	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (ch === '"') {
			if (inQuotes && body[i + 1] === '"') {
				cell += '"';
				i++;
				continue;
			}
			inQuotes = !inQuotes;
			continue;
		}
		if (!inQuotes && ch === "	") {
			row.push(cell);
			cell = "";
			continue;
		}
		if (!inQuotes && ch === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
			continue;
		}
		cell += ch;
	}
	row.push(cell);
	rows.push(row);
	return rows;
}

/** False for text that carries no cells, so a plain word paste is not offered. */
export function canPasteGrid(text: string, _rows: number, _cols: number): boolean {
	return text.trim().length > 0;
}

/**
 * Ctrl+D (down) / Ctrl+R (right): copies the first row/column of the selection
 * into every other row/column of it. The rest of the selection keeps whatever it
 * already held; only the axis being filled is overwritten.
 */
export function fillSelection(
	table: CsvTable,
	cells: Focus[],
	direction: "down" | "right",
	hiddenRows?: ReadonlySet<number>,
): CsvTable {
	const visibleCells = hiddenRows
		? cells.filter((cell) => !hiddenRows.has(cell.row))
		: cells;
	const rect = boundsOf(visibleCells);
	if (!rect) return table;
	const rows = visibleRowsInRect(rect, hiddenRows);
	if (rows.length === 0) return table;
	// Clone once and write in place; `setCell` would deep-copy the whole table
	// on every single cell, making a large fill O(cells × table).
	const out = clone(table);
	if (direction === "down") {
		// One write per column per row: the source is always the TOP visible row
		// of the selection, so every visible row ends up identical — no cascading
		// carry-over and no writes into hidden rows.
		const topRow = rows[0]!;
		for (let col = rect.left; col <= rect.right; col++) {
			const source = table.rows[topRow]?.[col] ?? "";
			for (let i = 1; i < rows.length; i++) {
				setCellInPlace(out, rows[i]!, col, source);
			}
		}
		return reindexRagged(out, out.headers.length);
	}
	for (const row of rows) {
		const source = table.rows[row]?.[rect.left] ?? "";
		for (let col = rect.left + 1; col <= rect.right; col++) {
			setCellInPlace(out, row, col, source);
		}
	}
	return reindexRagged(out, out.headers.length);
}

/** Blanks every selected visible cell, returning a new table. */
export function clearCells(
	table: CsvTable,
	cells: Focus[],
	hiddenRows?: ReadonlySet<number>,
): CsvTable {
	const out = clone(table);
	for (const cell of cells) {
		if (hiddenRows?.has(cell.row)) continue;
		if (cell.row < 0 || cell.row >= out.rows.length) continue;
		if (out.rows[cell.row]?.[cell.col] === "") continue;
		setCellInPlace(out, cell.row, cell.col, "");
	}
	return reindexRagged(out, out.headers.length);
}

/**
 * Escapes a value for a Markdown table cell: a pipe would be read as a column
 * separator, and newlines would end the row, so both become their entity.
 */
function escapeMarkdownCell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

/** Renders values as rows of `| a | b |`. */
function renderMarkdownRows(rows: string[][]): string[] {
	const lines: string[] = [];
	for (const row of rows) {
		lines.push(`| ${row.map(escapeMarkdownCell).join(" | ")} |`);
	}
	return lines;
}

/**
 * Renders the selection as an Obsidian Markdown table.
 *
 * A Markdown table needs a delimiter row (`| --- | --- |`) after the header.
 * The grid has no notion of a header row in a copy, so the selection's first
 * row is used as the header — which is what a pasted table looks like when
 * the top row of the selection is a header.
 */
export function serializeSelectionAsMarkdown(
	table: CsvTable,
	cells: Focus[],
	hiddenRows?: ReadonlySet<number>,
): string {
	const rect = boundsOf(cells);
	if (!rect) return "";
	const rows = visibleRowsInRect(rect, hiddenRows);
	if (rows.length === 0) return "";
	const lines: string[] = [];
	const colCount = rect.right - rect.left + 1;
	for (let r = 0; r < rows.length; r++) {
		const values: string[] = [];
		const row = rows[r]!;
		for (let c = 0; c < colCount; c++) {
			values.push(table.rows[row]?.[rect.left + c] ?? "");
		}
		lines.push(...renderMarkdownRows([values]));
		// After the first row, insert the delimiter row.
		if (r === 0) {
			lines.push(`| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`);
		}
	}
	return lines.join("\n");
}

/**
 * Detects whether clipboard text is a Markdown pipe table.
 *
 * A Markdown table has at least two rows where the second is a delimiter row
 * of dashes and pipes — that is the shape `serializeSelectionAsMarkdown` writes.
 */
export function isMarkdownTable(text: string): boolean {
	// Blank lines (a trailing newline, for one) carry no row and must not, by
	// themselves, disqualify an otherwise valid table.
	const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
	if (lines.length < 2) return false;
	// Every content row has to BE a pipe row. The old check accepted a line that
	// merely ended in a pipe, so prose like "a | b |" slipped through.
	for (const line of lines) {
		if (!line.trim().startsWith("|")) return false;
	}
	// The second line is the delimiter row.
	const delimiter = lines[1]?.trim() ?? "";
	return /^\|[\s\-:|]+\|$/.test(delimiter);
}

/**
 * Parses a Markdown pipe table into a grid of values.
 *
 * Skips the delimiter row. Empty cells become empty strings.
 */
export function parseMarkdownTable(text: string): string[][] {
	const lines = text.split(/\r?\n/);
	const rows: string[][] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]?.trim();
		if (!line || !line.startsWith("|")) continue;
		if (/^\|[\s\-:|]+\|$/.test(line)) continue; // delimiter row
		// Strip leading and trailing pipes, then split on unescaped pipes.
		const inner = line.slice(1, -1);
		const cells: string[] = [];
		let cell = "";
		for (let j = 0; j < inner.length; j++) {
			if (inner[j] === "\\" && inner[j + 1] === "|") {
				cell += "|";
				j++;
			} else if (inner[j] === "|") {
				cells.push(cell);
				cell = "";
			} else {
				cell += inner[j];
			}
		}
		cells.push(cell);
		rows.push(cells.map((c) => c.trim()));
	}
	return rows;
}

export function copyToClipboard(
	table: CsvTable,
	cells: Focus[],
	hiddenRows?: ReadonlySet<number>,
): string {
	return serializeSelectionAsMarkdown(table, cells, hiddenRows);
}

export function cutToClipboard(
	table: CsvTable,
	cells: Focus[],
	hiddenRows?: ReadonlySet<number>,
): { copied: string; table: CsvTable } {
	// Same format as copy: the two used to disagree (cut produced TSV while copy
	// produced a Markdown table), so a cut-and-paste into a note lost the table.
	const visibleCells = hiddenRows
		? cells.filter((cell) => !hiddenRows.has(cell.row))
		: cells;
	return {
		copied: serializeSelectionAsMarkdown(table, visibleCells, hiddenRows),
		table: clearCells(table, visibleCells, hiddenRows),
	};
}

/**
 * Writes a pasted grid with its top-left corner at `origin`, GROWING the table
 * when the paste runs past the last row or column — the way Excel does.
 *
 * When a filter is active (`hiddenRows`), pasted rows land only on visible rows
 * starting at `origin.row` so hidden records are never overwritten. Any rows
 * left over after the last visible row are appended to the end of the table.
 *
 * There are no formulas: every pasted cell is a literal value, so a paste that
 * extends the grid just creates blank rows/columns to hold it. `setCellInPlace`
 * refuses out-of-range targets, which is why the padding has to happen first.
 */
export function pasteGrid(
	table: CsvTable,
	grid: string[][],
	origin: Focus,
	hiddenRows?: ReadonlySet<number>,
): CsvTable {
	// One clone for the whole paste; `setCell` would copy the table per cell.
	const out = clone(table);
	const width = Math.max(
		0,
		...grid.map((row) => row?.length ?? 0),
	);
	const neededCols = origin.col + width;

	// Resolve target row indices first, skipping rows hidden by an active filter.
	// Once past the existing table, append blank rows as before.
	const targetRows: number[] = [];
	let candidate = origin.row;
	for (let row = 0; row < grid.length; row++) {
		while (candidate < out.rows.length && hiddenRows?.has(candidate)) {
			candidate++;
		}
		if (candidate >= out.rows.length) {
			out.rows.push(blankRow(columnCount(out)));
		}
		targetRows.push(candidate);
		candidate++;
	}

	// Then columns: the header AND every row grow together, so the grid stays
	// rectangular while it grows.
	if (neededCols > out.headers.length) {
		while (out.headers.length < neededCols) {
			out.headers.push(`Column ${out.headers.length + 1}`);
		}
		for (const row of out.rows) {
			while (row.length < out.headers.length) row.push("");
		}
	}

	for (let row = 0; row < grid.length; row++) {
		const targetRow = targetRows[row]!;
		const values = grid[row];
		for (let col = 0; col < (values?.length ?? 0); col++) {
			setCellInPlace(out, targetRow, origin.col + col, values?.[col] ?? "");
		}
	}
	return reindexRagged(out, out.headers.length);
}

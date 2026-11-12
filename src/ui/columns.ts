import { columnCount, type CsvTable } from "../parser/csv.ts";
import { cellDisplayWidth, stripInvisible } from "./format.ts";
import { displayText } from "./wikilinks.ts";

/**
 * Column sizing lives here as pure functions so it can be tested without a DOM.
 * The view supplies the actual pixel measurement afterwards.
 */

/** Narrower than this and a cell becomes unreadable. */
export const MIN_COLUMN_WIDTH = 48;

/**
 * The width of the trailing ghost column that holds the "+" affordance.
 *
 * It lives in the same 100% the data columns are laid out in, so it is a real
 * cost against the available width and every budget calculation has to subtract
 * it. Kept in sync with `.super-csv-editor-add-col` / the ghost `<col>`.
 */
export const GHOST_COLUMN_WIDTH = 34;

export type ManualWidths = Record<number, number>;

/**
 * The single widest text per column.
 *
 * The view measures these with the real DOM rather than guessing a width from a
 * character count, which is what previously truncated values: an estimate is
 * wrong for emoji, semibold headers and borders, and cannot know how wide a
 * cell actually renders.
 *
 * Every row is scanned, not a sample. This vault's largest file is 1085 rows and
 * measuring it costs ~5ms, so a cap would buy nothing and would clip the widest
 * value whenever it happened to sit low in the file.
 */
export function widestTextsByColumn(table: CsvTable): string[] {
	const cols = columnCount(table);
	if (cols === 0) return [];

	const widest: string[] = new Array<string>(cols).fill("");
	const consider = (raw: string, col: number): void => {
		if (col >= cols) return;
		// Measure what the cell actually shows: `[[target|alias]]` renders as
		// just `alias`, and ISO datetimes render reformatted. Width comes from
		// the DOM later; here we only pick which text to measure.
		const value = stripInvisible(displayText(raw));
		const current = widest[col] ?? "";
		// Strictly greater, so the header wins a tie. The real width comes from
		// the DOM afterwards; this only chooses which text gets measured.
		if (cellDisplayWidth(value) > cellDisplayWidth(current)) widest[col] = value;
	};

	for (let col = 0; col < cols; col++) consider(table.headers[col] ?? "", col);
	for (const row of table.rows) {
		for (let col = 0; col < cols; col++) consider(row[col] ?? "", col);
	}
	return widest;
}

/** Applies a drag delta, refusing to collapse a column past the minimum. */
export function resizeWidth(current: number, delta: number): number {
	return Math.max(MIN_COLUMN_WIDTH, Math.round(current + delta));
}

/**
 * Manual widths win over measured widths, per column. Stale entries for columns
 * that no longer exist are ignored, so deleting a column cannot corrupt layout.
 */
export function mergeWidths(
	measured: number[] | undefined,
	manual: ManualWidths,
): number[] {
	if (!measured) {
		return Object.entries(manual)
			.map(([col, width]) => [Number(col), Math.max(width, MIN_COLUMN_WIDTH)] as const)
			.sort((a, b) => a[0] - b[0])
			.map(([, width]) => width);
	}

	const out = [...measured];
	for (const [key, width] of Object.entries(manual)) {
		const col = Number(key);
		if (col < 0 || !Number.isFinite(col) || col >= out.length) continue;
		out[col] = Math.max(width, MIN_COLUMN_WIDTH);
	}
	return out;
}
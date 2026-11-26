import { columnCount, type CsvTable } from "../parser/csv.ts";
import { cellDisplayWidth, stripInvisible } from "./format.ts";
import { displayText } from "./wikilinks.ts";

/**
 * Column sizing lives here as pure functions so it can be tested without a DOM.
 * The view supplies the actual pixel measurement afterwards.
 */

/** Default minimum column width when no custom limit is configured. */
export const MIN_COLUMN_WIDTH = 48;

/** Uniform column width used when auto-fit is turned off. */
export const DEFAULT_COLUMN_WIDTH = 150;

export interface ColumnWidthLimits {
	/** Whether columns auto-fit to their content width (up to `max`). */
	autoFit: boolean;
	/** Minimum column width in px. */
	min: number;
	/** Maximum column width in px. 0 means no limit. */
	max: number;
}

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
 * The single widest data value per column (ignoring column headers).
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
	const bestWidth: number[] = new Array<number>(cols).fill(0);
	const consider = (raw: string, col: number): void => {
		if (!raw || col >= cols) return;
		// Measure what the cell actually shows: `[[target|alias]]` renders as
		// just `alias`, and ISO datetimes render reformatted. Width comes from
		// the DOM later; here we only pick which text to measure.
		const value = stripInvisible(displayText(raw));
		const width = cellDisplayWidth(value);
		if (width > (bestWidth[col] ?? 0)) {
			bestWidth[col] = width;
			widest[col] = value;
		}
	};

	for (const row of table.rows) {
		for (let col = 0; col < cols; col++) consider(row[col] ?? "", col);
	}
	return widest;
}

/** Single-column version of `widestTextsByColumn` for incremental edit checks. */
export function widestTextInColumn(table: CsvTable, col: number): string {
	let widest = "";
	let bestWidth = 0;
	const consider = (raw: string): void => {
		if (!raw) return;
		const value = stripInvisible(displayText(raw));
		const width = cellDisplayWidth(value);
		if (width > bestWidth) {
			bestWidth = width;
			widest = value;
		}
	};
	for (const row of table.rows) consider(row[col] ?? "");
	return widest;
}

/**
 * Clamps a column width to the configured min/max bounds.
 * `max <= 0` (or omitted) means no upper limit.
 */
export function clampColumnWidth(
	width: number,
	limits?: Partial<ColumnWidthLimits>,
): number {
	const min =
		limits?.min !== undefined && Number.isFinite(limits.min) && limits.min >= 0
			? Math.round(limits.min)
			: MIN_COLUMN_WIDTH;
	const rawMax = limits?.max ?? 0;
	const rounded = Math.round(width);
	if (Number.isFinite(rawMax) && rawMax > 0) {
		const max = Math.max(min, Math.round(rawMax));
		return Math.min(max, Math.max(min, rounded));
	}
	return Math.max(min, rounded);
}

/** Applies a drag delta, clamping to the configured min/max column width. */
export function resizeWidth(
	current: number,
	delta: number,
	limits?: Partial<ColumnWidthLimits>,
): number {
	return clampColumnWidth(current + delta, limits);
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
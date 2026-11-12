/**
 * How a row limit narrows the grid.
 *
 * The limit is a VIEW concern on purpose. Applying it to the parsed table would
 * make an edit inside a limited embed serialise a truncated CSV back over the
 * file, silently deleting every row past the limit. So these helpers only ever
 * clamp what is DRAWN and where focus may go; the parsed table keeps every row
 * and is what gets written back.
 */
import type { RowLimit } from "./embedParams.ts";

export type { RowLimit };

/** How many rows the grid may draw, given the limit. */
export function visibleRowCount(total: number, limit: RowLimit): number {
	if (limit === null) return total;
	return Math.min(total, limit);
}

/**
 * Keeps a row index inside the visible window. Down-arrow on the last visible
 * row must not walk into the hidden rows, and an empty grid clamps to 0 rather
 * than to -1.
 */
export function clampVisibleRow(row: number, visible: number): number {
	if (visible <= 0) return 0;
	return Math.min(Math.max(row, 0), visible - 1);
}
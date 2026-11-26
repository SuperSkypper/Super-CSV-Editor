import type { Focus } from "./navigation.ts";

export interface Selection {
	/** Where the drag started; shift always extends from here. */
	anchor: Focus;
	/** The cell the keyboard acts on. */
	focus: Focus;
	/** Ctrl/Cmd-clicked cells outside the rectangle. */
	extras: Focus[];
}

/**
 * The empty selection: nothing is selected at all.
 *
 * Clicking outside the grid clears the selection, and a cleared selection has
 * to be distinguishable from "one cell at 0,0". Returning null (instead of a
 * sentinel rectangle) makes every consumer honest: copy, cut, clear and the
 * status counter all ask `selectedCells` first and get an empty list.
 */
export function clearedSelection(): null {
	return null;
}

/** Every cell of the rectangle spanned by anchor and target, in reading order. */
export function rangeBetween(from: Focus, to: Focus): Focus[] {
	const top = Math.min(from.row, to.row);
	const bottom = Math.max(from.row, to.row);
	const left = Math.min(from.col, to.col);
	const right = Math.max(from.col, to.col);

	const cells: Focus[] = [];
	for (let row = top; row <= bottom; row++) {
		for (let col = left; col <= right; col++) {
			cells.push({ row, col });
		}
	}
	return cells;
}

/** Shift extends the existing rectangle and discards detached cells. */
export function shiftTo(selection: Selection, target: Focus): Selection {
	return { anchor: selection.anchor, focus: target, extras: [] };
}

/** Ctrl/Cmd toggles a detached cell without moving the focus. */
export function toggleExtra(selection: Selection, target: Focus): Selection {
	const exists = selection.extras.some(
		(cell) => cell.row === target.row && cell.col === target.col,
	);
	const extras = exists
		? selection.extras.filter(
				(cell) => cell.row !== target.row || cell.col !== target.col,
			)
		: [...selection.extras, target];
	return { ...selection, extras };
}

/** Rectangle plus detached cells, de-duplicated. Null selects nothing. */
export function selectedCells(
	selection: Selection | null,
	hiddenRows?: ReadonlySet<number>,
): Focus[] {
	if (selection === null) return [];
	const seen = new Set<string>();
	const cells: Focus[] = [];
	for (const cell of [
		...rangeBetween(selection.anchor, selection.focus),
		...selection.extras,
	]) {
		if (hiddenRows?.has(cell.row)) continue;
		const key = `${cell.row}:${cell.col}`;
		if (seen.has(key)) continue;
		seen.add(key);
		cells.push(cell);
	}
	return cells;
}

export function isSelected(
	selection: Selection | null,
	cell: Focus,
	hiddenRows?: ReadonlySet<number>,
): boolean {
	return selectedCells(selection, hiddenRows).some(
		(c) => c.row === cell.row && c.col === cell.col,
	);
}

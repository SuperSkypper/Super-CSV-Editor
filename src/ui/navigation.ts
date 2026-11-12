export interface Focus {
	row: number;
	col: number;
}

export interface GridSize {
	rows: number;
	cols: number;
}

export type Direction = "up" | "down" | "left" | "right" | "next" | "prev";

export function clampFocus(focus: Focus, size: GridSize): Focus {
	if (size.rows <= 0 || size.cols <= 0) return { row: 0, col: 0 };
	return {
		row: Math.min(Math.max(focus.row, 0), size.rows - 1),
		col: Math.min(Math.max(focus.col, 0), size.cols - 1),
	};
}

/**
 * Grid movement that matches a spreadsheet: arrows move within the grid and
 * stop at the edges, while Tab / Shift+Tab travel cell to cell in reading order
 * and wrap to the next or previous row.
 */
/**
 * Moves a focus from `from` to `to`, stepping over the rows `isHidden` reports
 * as hidden — an active search filter, for instance.
 *
 * `direction` fixes which way to look when the landing row is hidden: down /
 * next look forward, up / prev backward, and left / right never change the row.
 * When no shown row lies that way the ORIGINAL focus is returned, so a filter
 * can never strand the caret off the grid. With nothing hidden this is the
 * identity on `to`, which keeps the unfiltered behaviour byte-for-byte.
 */
export function skipHiddenRows(
	from: Focus,
	to: Focus,
	direction: Direction,
	rows: number,
	isHidden: (row: number) => boolean,
): Focus {
	const step =
		direction === "down" || direction === "next"
			? 1
			: direction === "up" || direction === "prev"
				? -1
				: 0;
	if (step === 0) return to;
	let row = to.row;
	while (row >= 0 && row < rows && isHidden(row)) row += step;
	if (row < 0 || row >= rows) return from;
	return { row, col: to.col };
}

export function nextFocus(focus: Focus, size: GridSize, direction: Direction): Focus {
	const { rows, cols } = size;
	if (rows <= 0 || cols <= 0) return { row: 0, col: 0 };

	switch (direction) {
		case "right":
			return clampFocus({ row: focus.row, col: focus.col + 1 }, size);
		case "left":
			return clampFocus({ row: focus.row, col: focus.col - 1 }, size);
		case "down":
			return clampFocus({ row: focus.row + 1, col: focus.col }, size);
		case "up":
			return clampFocus({ row: focus.row - 1, col: focus.col }, size);
		case "next": {
			// Last column: continue on the next row, but never wrap past the end.
			if (focus.col >= cols - 1) {
				if (focus.row >= rows - 1) return { row: focus.row, col: focus.col };
				return { row: focus.row + 1, col: 0 };
			}
			return { row: focus.row, col: focus.col + 1 };
		}
		case "prev": {
			if (focus.col <= 0) {
				if (focus.row <= 0) return { row: 0, col: 0 };
				return { row: focus.row - 1, col: cols - 1 };
			}
			return { row: focus.row, col: focus.col - 1 };
		}
	}
}

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampFocus, nextFocus, skipHiddenRows } from "./navigation.ts";

// The complaint that motivated this plugin was sluggish cell editing, so the
// navigation rules are unit-tested rather than tuned by feel.
describe("nextFocus", () => {
	const size = { rows: 4, cols: 3 };

	it("moves right with ArrowRight", () => {
		assert.deepEqual(nextFocus({ row: 0, col: 0 }, size, "right"), { row: 0, col: 1 });
	});

	it("moves down with ArrowDown", () => {
		assert.deepEqual(nextFocus({ row: 0, col: 0 }, size, "down"), { row: 1, col: 0 });
	});

	it("moves to the next row at the end of a row with Tab", () => {
		assert.deepEqual(nextFocus({ row: 0, col: 2 }, size, "next"), { row: 1, col: 0 });
	});

	it("moves to the previous row at the start of a row with Shift+Tab", () => {
		assert.deepEqual(nextFocus({ row: 1, col: 0 }, size, "prev"), { row: 0, col: 2 });
	});

	it("does not wrap past the last cell with Tab", () => {
		assert.deepEqual(nextFocus({ row: 3, col: 2 }, size, "next"), { row: 3, col: 2 });
	});

	it("does not wrap before the first cell with Shift+Tab", () => {
		assert.deepEqual(nextFocus({ row: 0, col: 0 }, size, "prev"), { row: 0, col: 0 });
	});

	it("clamps at the right edge with ArrowRight", () => {
		assert.deepEqual(nextFocus({ row: 1, col: 2 }, size, "right"), { row: 1, col: 2 });
	});

	it("clamps at the left edge with ArrowLeft", () => {
		assert.deepEqual(nextFocus({ row: 1, col: 0 }, size, "left"), { row: 1, col: 0 });
	});

	it("jumps to the next column with Tab held past the row end", () => {
		assert.deepEqual(nextFocus({ row: 0, col: 2 }, size, "right"), { row: 0, col: 2 });
	});
});

describe("clampFocus", () => {
	it("pulls focus back inside the grid after a row is deleted", () => {
		assert.deepEqual(clampFocus({ row: 5, col: 0 }, { rows: 2, cols: 3 }), { row: 1, col: 0 });
	});

	it("pulls focus back after the last column is deleted", () => {
		assert.deepEqual(clampFocus({ row: 0, col: 4 }, { rows: 2, cols: 2 }), { row: 0, col: 1 });
	});

	it("keeps a valid focus untouched", () => {
		assert.deepEqual(clampFocus({ row: 1, col: 1 }, { rows: 3, cols: 3 }), { row: 1, col: 1 });
	});

	it("floors a negative focus at the origin", () => {
		assert.deepEqual(clampFocus({ row: -2, col: -1 }, { rows: 3, cols: 3 }), { row: 0, col: 0 });
	});

	it("returns the origin when the grid is empty", () => {
		assert.deepEqual(clampFocus({ row: 3, col: 3 }, { rows: 0, cols: 0 }), { row: 0, col: 0 });
	});
});

// A filtered sheet hides rows, and the caret has to step over them the way it
// steps over nothing at all without a filter.
describe("skipHiddenRows", () => {
	const hidden = (rows: number[]) => (row: number) => rows.includes(row);
	const to = { row: 1, col: 2 };

	it("is the identity when nothing is hidden", () => {
		assert.deepEqual(skipHiddenRows({ row: 0, col: 2 }, to, "down", 5, () => false), to);
	});

	it("steps forward past hidden rows on ArrowDown", () => {
		const from = { row: 0, col: 2 };
		assert.deepEqual(skipHiddenRows(from, to, "down", 5, hidden([1, 2])), { row: 3, col: 2 });
	});

	it("steps backward past hidden rows on ArrowUp", () => {
		const from = { row: 4, col: 2 };
		assert.deepEqual(
			skipHiddenRows(from, { row: 3, col: 2 }, "up", 5, hidden([2, 3])),
			{ row: 1, col: 2 },
		);
	});

	it("stays on the row for a horizontal move", () => {
		assert.deepEqual(skipHiddenRows({ row: 1, col: 0 }, to, "right", 5, hidden([1])), to);
	});

	it("keeps the column of the target focus", () => {
		const from = { row: 0, col: 0 };
		assert.deepEqual(
			skipHiddenRows(from, { row: 0, col: 3 }, "down", 5, hidden([0])),
			{ row: 1, col: 3 },
		);
	});

	it("falls back to the original focus when every row ahead is hidden", () => {
		const from = { row: 1, col: 2 };
		assert.deepEqual(skipHiddenRows(from, { row: 2, col: 2 }, "down", 4, hidden([2, 3])), from);
	});

	it("falls back to the original focus when every row behind is hidden", () => {
		const from = { row: 2, col: 2 };
		assert.deepEqual(skipHiddenRows(from, { row: 1, col: 2 }, "up", 4, hidden([0, 1])), from);
	});
});

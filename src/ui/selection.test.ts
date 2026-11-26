import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	clearedSelection,
	isSelected,
	rangeBetween,
	selectedCells,
	type Selection,
	shiftTo,
	toggleExtra,
} from "./selection.ts";

const anchor = { row: 1, col: 1 };

describe("rangeBetween", () => {
	it("covers a rectangle between two cells", () => {
		const cells = rangeBetween({ row: 1, col: 1 }, { row: 2, col: 3 });
		assert.deepEqual(cells, [
			{ row: 1, col: 1 },
			{ row: 1, col: 2 },
			{ row: 1, col: 3 },
			{ row: 2, col: 1 },
			{ row: 2, col: 2 },
			{ row: 2, col: 3 },
		]);
	});

	it("works when the target is up and to the left of the anchor", () => {
		const cells = rangeBetween({ row: 2, col: 3 }, { row: 1, col: 1 });
		assert.deepEqual(cells, [
			{ row: 1, col: 1 },
			{ row: 1, col: 2 },
			{ row: 1, col: 3 },
			{ row: 2, col: 1 },
			{ row: 2, col: 2 },
			{ row: 2, col: 3 },
		]);
	});

	it("returns a single cell when anchor and target match", () => {
		assert.deepEqual(rangeBetween(anchor, anchor), [anchor]);
	});
});

describe("shiftTo", () => {
	const base: Selection = { anchor, focus: anchor, extras: [] };

	it("keeps the anchor and moves the focus", () => {
		const next = shiftTo(base, { row: 3, col: 2 });
		assert.deepEqual(next.anchor, anchor);
		assert.deepEqual(next.focus, { row: 3, col: 2 });
	});

	it("drops detached cells, since shift extends one rectangle", () => {
		const withExtras: Selection = { ...base, extras: [{ row: 5, col: 5 }] };
		const next = shiftTo(withExtras, { row: 2, col: 2 });
		assert.deepEqual(next.extras, []);
	});
});

describe("toggleExtra", () => {
	const base: Selection = { anchor, focus: anchor, extras: [] };

	it("adds a detached cell", () => {
		const next = toggleExtra(base, { row: 4, col: 0 });
		assert.deepEqual(next.extras, [{ row: 4, col: 0 }]);
	});

	it("removes a cell that was already detached", () => {
		const once = toggleExtra(base, { row: 4, col: 0 });
		const twice = toggleExtra(once, { row: 4, col: 0 });
		assert.deepEqual(twice.extras, []);
	});
});

describe("selectedCells", () => {
	it("expands anchor-to-focus plus detached cells", () => {
		const sel: Selection = {
			anchor: { row: 0, col: 0 },
			focus: { row: 0, col: 1 },
			extras: [{ row: 2, col: 2 }],
		};
		assert.deepEqual(selectedCells(sel), [
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
			{ row: 2, col: 2 },
		]);
	});

	it("never lists the same cell twice", () => {
		const sel: Selection = {
			anchor: { row: 0, col: 0 },
			focus: { row: 1, col: 1 },
			extras: [{ row: 0, col: 0 }, { row: 1, col: 1 }],
		};
		assert.equal(selectedCells(sel).length, 4);
	});

	it("is just the focus cell for a fresh selection", () => {
		assert.deepEqual(selectedCells({ anchor, focus: anchor, extras: [] }), [anchor]);
	});
});

/**
 * Clicking away from the grid clears the selection entirely, in the standalone
 * view as well as inside an embed. That is different from "select the cell the
 * cursor is on": emptiness is modelled as a NULL selection rather than a
 * sentinel rectangle, so every consumer asking "what is selected?" gets the
 * truth for free and cannot act on a cell the user already dismissed.
 */
describe("selectedCells with no selection", () => {
	it("returns nothing when the selection is null", () => {
		assert.deepEqual(selectedCells(null), []);
	});

	it("returns the rectangle and detached cells when it exists", () => {
		const sel: Selection = {
			anchor: { row: 1, col: 1 },
			focus: { row: 2, col: 3 },
			extras: [{ row: 8, col: 8 }],
		};
		assert.equal(selectedCells(sel).length, 7); // 2x3 rectangle + 1 detached
	});
});

describe("isSelected with no selection", () => {
	it("is false for every cell", () => {
		assert.equal(isSelected(null, { row: 0, col: 0 }), false);
		assert.equal(isSelected(null, { row: 8, col: 8 }), false);
	});
});

describe("clearedSelection", () => {
	it("is null, so nothing is selected at all", () => {
		assert.equal(clearedSelection(), null);
		assert.deepEqual(selectedCells(clearedSelection()), []);
	});
});

describe("isSelected", () => {
	it("is true for a cell inside the rectangle", () => {
		const sel: Selection = {
			anchor: { row: 0, col: 0 },
			focus: { row: 1, col: 1 },
			extras: [],
		};
		assert.equal(isSelected(sel, { row: 1, col: 0 }), true);
		assert.equal(isSelected(sel, { row: 2, col: 0 }), false);
	});

	it("is true for a detached cell", () => {
		const sel: Selection = { anchor, focus: anchor, extras: [{ row: 9, col: 9 }] };
		assert.equal(isSelected(sel, { row: 9, col: 9 }), true);
	});
});

describe("selectedCells with hiddenRows", () => {
	it("excludes filtered-out rows from a dragged rectangle", () => {
		const sel: Selection = {
			anchor: { row: 0, col: 0 },
			focus: { row: 4, col: 0 },
			extras: [],
		};
		const hidden = new Set([1, 3]);
		assert.deepEqual(selectedCells(sel, hidden), [
			{ row: 0, col: 0 },
			{ row: 2, col: 0 },
			{ row: 4, col: 0 },
		]);
	});

	it("excludes hidden rows from detached extras as well", () => {
		const sel: Selection = {
			anchor: { row: 0, col: 0 },
			focus: { row: 0, col: 0 },
			extras: [{ row: 1, col: 1 }, { row: 2, col: 1 }],
		};
		const hidden = new Set([1]);
		assert.deepEqual(selectedCells(sel, hidden), [
			{ row: 0, col: 0 },
			{ row: 2, col: 1 },
		]);
		assert.equal(isSelected(sel, { row: 1, col: 1 }, hidden), false);
		assert.equal(isSelected(sel, { row: 2, col: 1 }, hidden), true);
	});
});

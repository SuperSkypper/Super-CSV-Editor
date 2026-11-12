import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleRowCount, clampVisibleRow } from "./rowLimit.ts";

/**
 * A row limit is a VIEW concern. If it were applied to the parsed data, an edit
 * inside a limited embed would serialise a truncated table back over the file
 * and silently delete every row past the limit. So the limit only ever clamps
 * what is drawn and what focus may move to; `this.table` keeps every row.
 */
describe("visibleRowCount", () => {
	it("returns every row when there is no limit", () => {
		assert.equal(visibleRowCount(7, null), 7);
	});

	it("returns the limit when it is smaller than the row count", () => {
		assert.equal(visibleRowCount(7, 5), 5);
	});

	it("returns the real row count when the limit exceeds it", () => {
		assert.equal(visibleRowCount(3, 5), 3);
	});
});

describe("clampVisibleRow", () => {
	it("keeps a row inside the window", () => {
		assert.equal(clampVisibleRow(2, 5), 2);
	});

	it("uses the fallback when nothing is visible", () => {
		assert.equal(clampVisibleRow(6, 0), 0);
	});

	it("pulls a row back to the last visible one", () => {
		// visible=5 means rows 0..4, so row 6 clamps to 4, not to the
		// fallback. The fallback only applies when nothing is visible.
		assert.equal(clampVisibleRow(6, 5), 4);
	});

	it("never goes negative on an empty grid", () => {
		assert.equal(clampVisibleRow(4, 0), 0);
	});
});
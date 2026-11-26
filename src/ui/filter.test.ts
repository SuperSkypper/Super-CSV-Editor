import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchingRowIndexes } from "./filter.ts";
import type { CsvTable } from "../parser/csv.ts";

// The search box filters the sheet, so which rows survive is the whole feature;
// the match rule is unit-tested rather than eyeballed in the grid.
function table(rows: string[][]): CsvTable {
	return { headers: [], rows, raggedRows: [] };
}

const people = table([
	["Ada", "London", "1815"],
	["Grace", "New York", "1906"],
	["Alan", "London", "1912"],
]);

describe("matchingRowIndexes", () => {
	it("keeps rows where any cell contains the query", () => {
		assert.deepEqual(matchingRowIndexes(people, "london"), [0, 2]);
	});

	it("matches case-insensitively", () => {
		assert.deepEqual(matchingRowIndexes(people, "LONDON"), [0, 2]);
	});

	it("matches a partial value, not just a whole cell", () => {
		assert.deepEqual(matchingRowIndexes(people, "rac"), [1]);
	});

	it("matches a cell that is not the first column", () => {
		assert.deepEqual(matchingRowIndexes(people, "1912"), [2]);
	});

	it("returns rows in file order", () => {
		assert.deepEqual(matchingRowIndexes(people, "a"), [0, 1, 2]);
	});

	it("returns no rows when nothing matches", () => {
		assert.deepEqual(matchingRowIndexes(people, "zebra"), []);
	});

	it("shows every row for an empty query", () => {
		assert.deepEqual(matchingRowIndexes(people, ""), [0, 1, 2]);
	});

	it("treats a whitespace-only query as empty, not as a literal space", () => {
		assert.deepEqual(matchingRowIndexes(people, "   "), [0, 1, 2]);
	});

	it("ignores surrounding whitespace in the query", () => {
		assert.deepEqual(matchingRowIndexes(people, "  london  "), [0, 2]);
	});

	it("survives ragged rows", () => {
		const ragged = table([["Ada"], ["", "Grace"], []]);
		assert.deepEqual(matchingRowIndexes(ragged, "grace"), [1]);
	});

	it("scopes matching to a single column when column index is provided", () => {
		const mixed = table([
			["London", "Ada", "1815"],
			["Grace", "London", "1906"],
			["Alan", "London", "1912"],
		]);
		assert.deepEqual(matchingRowIndexes(mixed, "london", 0), [0]);
		assert.deepEqual(matchingRowIndexes(mixed, "london", 1), [1, 2]);
		assert.deepEqual(matchingRowIndexes(mixed, "london", 2), []);
	});

	it("handles ragged rows and empty queries when scoped to a column", () => {
		const ragged = table([["Ada"], ["", "Grace"], []]);
		assert.deepEqual(matchingRowIndexes(ragged, "grace", 1), [1]);
		assert.deepEqual(matchingRowIndexes(ragged, "grace", 0), []);
		assert.deepEqual(matchingRowIndexes(ragged, "", 1), [0, 1, 2]);
	});
});

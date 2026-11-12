import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsv } from "./csv.ts";
import {
	deleteColumn,
	deleteRow,
	insertColumn,
	insertRow,
	moveColumn,
	moveRow,
	renameColumn,
	setCell,
	sortRows,
} from "./table.ts";

const base = () =>
	parseCsv("a,b,c\n1,2,3\n4,5,6", ",");

describe("setCell", () => {
	it("writes a value into an existing cell", () => {
		const t = setCell(base(), 0, 1, "X");
		assert.deepEqual(t.rows[0], ["1", "X", "3"]);
	});

	it("does not mutate the input table", () => {
		const t = base();
		setCell(t, 0, 0, "changed");
		assert.equal(t.rows[0]![0], "1");
	});

	it("writes an empty string without removing the column", () => {
		const t = setCell(base(), 1, 2, "");
		assert.deepEqual(t.rows[1], ["4", "5", ""]);
	});
});

describe("insertRow", () => {
	it("inserts a blank row at the given index", () => {
		const t = insertRow(base(), 1);
		assert.deepEqual(t.rows, [
			["1", "2", "3"],
			["", "", ""],
			["4", "5", "6"],
		]);
	});

	it("appends a row at the end", () => {
		const t = insertRow(base(), 99);
		assert.equal(t.rows.length, 3);
		assert.deepEqual(t.rows[2], ["", "", ""]);
	});

	it("blank row matches the grid width, not the header width", () => {
		const t = insertRow(parseCsv("a,b\n1,2,3", ","), 0);
		assert.deepEqual(t.rows[0], ["", "", ""]);
	});
});

describe("deleteRow", () => {
	it("removes the row at the index", () => {
		const t = deleteRow(base(), 0);
		assert.deepEqual(t.rows, [["4", "5", "6"]]);
	});

	it("keeps a ragged flag consistent after reindexing", () => {
		// Row 0 is the wide one, row 1 matches the header width.
		const t = parseCsv("a,b\n1,2,3\n4,5", ",");
		const after = deleteRow(t, 0);
		assert.deepEqual(after.rows, [["4", "5"]]);
		// The remaining row now matches the header, so nothing is ragged.
		assert.deepEqual(after.raggedRows, []);
	});
});

describe("moveRow", () => {
	it("moves a row down", () => {
		const t = moveRow(base(), 0, 1);
		assert.deepEqual(t.rows, [
			["4", "5", "6"],
			["1", "2", "3"],
		]);
	});

	it("moves a row up", () => {
		const t = moveRow(base(), 1, 0);
		assert.deepEqual(t.rows, [
			["4", "5", "6"],
			["1", "2", "3"],
		]);
	});

	it("clamps an out-of-range target to the last row instead of failing", () => {
		const t = moveRow(base(), 0, 9);
		assert.deepEqual(t.rows, [
			["4", "5", "6"],
			["1", "2", "3"],
		]);
	});

	it("is a no-op when the source index does not exist", () => {
		const t = moveRow(base(), 9, 0);
		assert.deepEqual(t.rows, [
			["1", "2", "3"],
			["4", "5", "6"],
		]);
	});
});

describe("insertColumn", () => {
	it("inserts a column at the index with the given header", () => {
		const t = insertColumn(base(), 1, "new");
		assert.deepEqual(t.headers, ["a", "new", "b", "c"]);
		assert.deepEqual(t.rows[0], ["1", "", "2", "3"]);
	});

	it("gives a blank header when none is supplied", () => {
		const t = insertColumn(base(), 0, "");
		assert.deepEqual(t.headers, ["", "a", "b", "c"]);
	});
});

describe("deleteColumn", () => {
	it("removes the header and that cell from every row", () => {
		const t = deleteColumn(base(), 1);
		assert.deepEqual(t.headers, ["a", "c"]);
		assert.deepEqual(t.rows[0], ["1", "3"]);
		assert.deepEqual(t.rows[1], ["4", "6"]);
	});
});

describe("moveColumn", () => {
	it("moves a column right", () => {
		const t = moveColumn(base(), 0, 2);
		assert.deepEqual(t.headers, ["b", "c", "a"]);
		assert.deepEqual(t.rows[0], ["2", "3", "1"]);
	});

	it("moves a column left", () => {
		const t = moveColumn(base(), 2, 0);
		assert.deepEqual(t.headers, ["c", "a", "b"]);
		assert.deepEqual(t.rows[0], ["3", "1", "2"]);
	});

	// The context menu disables these at the edges, but the pure function must
	// still be safe: a stray call must not drop or duplicate a column.
	it("is a no-op when moving the first column further left", () => {
		const t = moveColumn(base(), 0, -1);
		assert.deepEqual(t.headers, ["a", "b", "c"]);
		assert.deepEqual(t.rows[0], ["1", "2", "3"]);
	});

	it("is a no-op when moving the last column further right", () => {
		const t = moveColumn(base(), 2, 3);
		assert.deepEqual(t.headers, ["a", "b", "c"]);
		assert.deepEqual(t.rows[0], ["1", "2", "3"]);
	});
});

describe("renameColumn", () => {
	it("renames the header in place", () => {
		const t = renameColumn(base(), 1, "B renamed");
		assert.deepEqual(t.headers, ["a", "B renamed", "c"]);
	});
});

describe("ragged bookkeeping survives edits", () => {
	// A padded short row is physically full width, so a naive `row.length`
	// comparison forgets it was short the moment anything is edited.
	it("keeps a short row flagged after an unrelated cell is edited", () => {
		const t = setCell(parseCsv("a,b,c\n1,2\n3,4,5", ","), 1, 0, "9");
		assert.deepEqual(t.raggedRows, [0]);
	});

	it("keeps a short row flagged after a column is inserted", () => {
		const t = insertColumn(parseCsv("a,b,c\n1,2\n3,4,5", ","), 3, "d");
		assert.deepEqual(t.raggedRows, [0]);
	});

	it("keeps a short row flagged after a column is deleted", () => {
		const t = deleteColumn(parseCsv("a,b,c\n1,2\n3,4,5", ","), 0);
		assert.deepEqual(t.raggedRows, [0]);
	});
});

describe("sortRows", () => {
	it("sorts rows ascending by the chosen column", () => {
		const t = parseCsv("name,age\nCharlie,30\nAlice,25\nBob,22", ",");
		const out = sortRows(t, 0, "asc");
		assert.deepEqual(out.rows.map((r) => r[0]), ["Alice", "Bob", "Charlie"]);
	});

	it("sorts rows descending by the chosen column", () => {
		const t = parseCsv("name,age\nCharlie,30\nAlice,25\nBob,22", ",");
		const out = sortRows(t, 0, "desc");
		assert.deepEqual(out.rows.map((r) => r[0]), ["Charlie", "Bob", "Alice"]);
	});

	it("keeps empty values at the end in ascending order", () => {
		const t = parseCsv("name,age\nCharlie,30\n,25\nBob,22", ",");
		const out = sortRows(t, 0, "asc");
		assert.deepEqual(out.rows.map((r) => r[0]), ["Bob", "Charlie", ""]);
	});

	it("orders numbers numerically, not lexicographically", () => {
		const t = parseCsv("n\n2\n10\n1\n20", ",");
		const out = sortRows(t, 0, "asc");
		assert.deepEqual(out.rows.map((r) => r[0]), ["1", "2", "10", "20"]);
	});

	it("does not mutate the input table", () => {
		const t = parseCsv("name\nBob\nAlice", ",");
		sortRows(t, 0, "asc");
		assert.deepEqual(t.rows.map((r) => r[0]), ["Bob", "Alice"]);
	});

	it("returns the table unchanged for a column that does not exist", () => {
		const t = parseCsv("a\n2\n1", ",");
		const out = sortRows(t, 99, "asc");
		assert.deepEqual(out.rows.map((r) => r[0]), ["2", "1"]);
	});
});

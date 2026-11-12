import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsv, stringifyCsv } from "./csv.ts";
import {
	deleteColumn,
	deleteRows,
	insertColumn,
	insertRow,
	moveRow,
	setCell,
	sortRows,
} from "./table.ts";

/**
 * Opening a CSV must never change its bytes.
 *
 * `onUnloadFile` saves the grid on close, and `isDirty` compares the
 * serialised table with the text that was loaded. If the parser normalises
 * anything — padding a short row, dropping a blank line, adding a trailing
 * newline — the file gets rewritten by the act of looking at it, and the
 * user's data changes without an edit. These cases are the regression net for
 * exactly that.
 */
describe("round-trip fidelity", () => {
	const cases: Array<[string, string]> = [
		["regular", "A,B\n1,2\n3,4\n"],
		["short row (fewer fields than headers)", "A,B,C\n1,2\n3,4,5\n"],
		["long row (more fields than headers)", "A,B\n1,2,3\n4,5\n"],
		["blank line in the middle", "A,B\n1,2\n\n3,4\n"],
		["two blank lines in the middle", "A,B\n1,2\n\n\n3,4\n"],
		["blank line first", "A,B\n\n1,2\n"],
		["blank line last", "A,B\n1,2\n\n"],
		["no trailing newline", "A,B\n1,2"],
		["CRLF", "A,B\r\n1,2\r\n"],
		["CRLF with short row and blank", "A,B,C\r\n1,2\r\n\r\n3,4,5\r\n"],
		["CRLF with blank at end", "A,B\r\n1,2\r\n\r\n"],
		["quoted delimiter", 'A,B\n"x,y",2\n'],
		["quoted newline", 'A,B\n"x\ny",2\n'],
		["headers only", "A,B\n"],
		["headers only, no newline", "A,B"],
		["single column", "A\n1\n2\n"],
		["empty file", ""],
	];

	for (const [name, text] of cases) {
		it(`preserves bytes: ${name}`, () => {
			assert.equal(stringifyCsv(parseCsv(text, ","), ","), text);
		});
	}

	it("re-serialising repeatedly is stable", () => {
		const text = "A,B,C\n1,2\n\n3,4,5\n";
		const once = stringifyCsv(parseCsv(text, ","), ",");
		const twice = stringifyCsv(parseCsv(once, ","), ",");
		assert.equal(twice, once);
	});
});

describe("row width bookkeeping survives edits", () => {
	it("a short row stays short after an unrelated row is inserted above it", () => {
		const original = "A,B,C\n1,2\n3,4,5\n";
		const table = insertRow(parseCsv(original, ","), 0);
		assert.equal(stringifyCsv(table, ","), "A,B,C\n,,\n1,2\n3,4,5\n");
	});

	it("a line of empty fields keeps its delimiters", () => {
		const original = "A,B,C\n,,\n1,2\n3,4,5\n";
		assert.equal(stringifyCsv(parseCsv(original, ","), ","), original);
		const table = insertRow(parseCsv(original, ","), 0);
		assert.equal(stringifyCsv(table, ","), "A,B,C\n,,\n,,\n1,2\n3,4,5\n");
	});

	it("a short row keeps its width when a row is deleted above it", () => {
		const original = "A,B,C\n,,\n1,2\n3,4,5\n";
		const table = deleteRows(parseCsv(original, ","), [0]);
		assert.equal(stringifyCsv(table, ","), "A,B,C\n1,2\n3,4,5\n");
	});

	it("a short row keeps its width when moved", () => {
		const original = "A,B,C\n1,2\n3,4,5\n9,8,7\n";
		const table = moveRow(parseCsv(original, ","), 0, 2);
		assert.equal(stringifyCsv(table, ","), "A,B,C\n3,4,5\n9,8,7\n1,2\n");
	});

	it("a blank line stays blank after a sort", () => {
		const original = "N\n3\n\n1\n2\n";
		const table = sortRows(parseCsv(original, ","), 0, "asc");
		const out = stringifyCsv(table, ",");
		assert.equal(out, "N\n1\n2\n3\n\n");
		assert.ok(out.includes("\n\n"), "the blank line must survive the sort");
	});

	it("typing into a blank line turns it into a real record", () => {
		const original = "A,B\n1,2\n\n3,4\n";
		const table = setCell(parseCsv(original, ","), 1, 0, "x");
		assert.equal(stringifyCsv(table, ","), "A,B\n1,2\nx\n3,4\n");
	});

	it("a padded row is written at full width once the user fills the pad cell", () => {
		const original = "A,B,C\n1,2\n";
		const table = setCell(parseCsv(original, ","), 0, 2, "z");
		assert.equal(stringifyCsv(table, ","), "A,B,C\n1,2,z\n");
	});

	it("a row added by the user is written at full width", () => {
		const original = "A,B,C\n1,2\n";
		const table = insertRow(parseCsv(original, ","), 1);
		assert.equal(stringifyCsv(table, ","), "A,B,C\n1,2\n,,\n");
	});

	it("a full-width row stays full width after a column is inserted", () => {
		const table = insertColumn(parseCsv("A,B\n1,2\n", ","), 1, "X");
		assert.equal(stringifyCsv(table, ","), "A,X,B\n1,,2\n");
	});

	it("a full-width row stays full width after a column is deleted", () => {
		const table = deleteColumn(parseCsv("A,B,C\n1,2,3\n", ","), 1);
		assert.equal(stringifyCsv(table, ","), "A,C\n1,3\n");
	});
});
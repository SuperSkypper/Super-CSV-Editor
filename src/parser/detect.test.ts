import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectDelimiter } from "./detect.ts";

// Fixtures are verbatim excerpts from the vault's 1097 CSV files.
describe("detectDelimiter", () => {
	it("picks comma for the standard log header", () => {
		const header = "file name,Start Log,End Log,Duration,Media,Version,Participants";
		assert.equal(detectDelimiter(header), ",");
	});

	it("picks semicolon for the 30 semicolon-delimited files", () => {
		const header = "Title;Start Log;End Log;Duration;Participants;Notes";
		assert.equal(detectDelimiter(header), ";");
	});

	it("ignores delimiters inside quoted fields", () => {
		const header = '"Lois Lane, The",Start Log,End Log';
		assert.equal(detectDelimiter(header), ",");
	});

	it("falls back to comma when the header has no delimiter", () => {
		assert.equal(detectDelimiter("Name"), ",");
	});

	it("picks tab for a tab-separated body", () => {
		const text = "a	b	c\n1	2	3\n4	5	6";
		assert.equal(detectDelimiter(text), "	");
	});

	it("picks semicolon over comma when the body is semicolon-separated", () => {
		// A semicolon file read as comma gives ragged rows; semicolon is consistent.
		const text = "Title;Start Log;End Log\nA;2024-01-01T00:00:00;2024-01-01T01:00:00";
		assert.equal(detectDelimiter(text), ";");
	});

	it("ignores invisible LTR marks when counting columns", () => {
		// 516 occurrences of U+200E exist in the vault's headers.
		const header = "Hours,Name,Start Log‎ ‎,End Log‎,Duration‎";
		assert.equal(detectDelimiter(header), ",");
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { columnCount, parseCsv, stringifyCsv } from "./csv.ts";

// Fixtures are verbatim excerpts from the vault's 1097 CSV files.
describe("parseCsv", () => {
	it("parses the standard log header and rows", () => {
		const text = [
			"file name,Start Log,End Log,Duration,Media,Version,Participants",
			"{210701-000000} Batman (1992) ~ S01E02 + (Ju),2021-07-01T00:00:00,2021-07-01T00:00:00,0h 0m,,,",
		].join("\n");
		const result = parseCsv(text, ",");
		assert.deepEqual(result.headers, [
			"file name",
			"Start Log",
			"End Log",
			"Duration",
			"Media",
			"Version",
			"Participants",
		]);
		assert.equal(result.rows.length, 1);
		assert.equal(result.rows[0]![1], "2021-07-01T00:00:00");
	});

	it("keeps a quoted comma inside a field", () => {
		// Real file: {1958} Superman's Girl Friend, Lois Lane
		const text = 'Title,Start Log\n"{250426-154500} Superman\'s Girl Friend, Lois Lane ~ 017",2025-04-26T15:45:00';
		const result = parseCsv(text, ",");
		assert.equal(result.rows.length, 1);
		assert.equal(result.rows[0]![0], "{250426-154500} Superman's Girl Friend, Lois Lane ~ 017");
	});

	it("unescapes doubled quotes inside a quoted field", () => {
		const text = 'a,b\n"He said ""hi""",2';
		const result = parseCsv(text, ",");
		assert.equal(result.rows[0]![0], 'He said "hi"');
	});

	it("handles CRLF line endings", () => {
		const result = parseCsv("a,b\r\n1,2\r\n", ",");
		assert.deepEqual(result.headers, ["a", "b"]);
		assert.deepEqual(result.rows, [["1", "2"]]);
	});

	it("treats a trailing newline as no extra row", () => {
		const result = parseCsv("a,b\n1,2\n", ",");
		assert.equal(result.rows.length, 1);
	});

	it("keeps an embedded newline inside a quoted field", () => {
		const result = parseCsv('a,b\n"line1\nline2",2', ",");
		assert.equal(result.rows.length, 1);
		assert.equal(result.rows[0]![0], "line1\nline2");
	});

	it("pads ragged rows with empty strings to the header width", () => {
		const result = parseCsv("a,b,c\n1,2\n1,2,3,4", ",");
		assert.deepEqual(result.rows[0], ["1", "2", ""]);
		assert.deepEqual(result.rows[1], ["1", "2", "3", "4"]);
	});

	it("reports rows wider than the header so the view can flag them", () => {
		const result = parseCsv("a,b\n1,2,3", ",");
		assert.equal(result.rows.length, 1);
		assert.deepEqual(result.raggedRows, [0]);
		// The wider row keeps its cells: truncating on save would destroy data.
		assert.deepEqual(result.rows[0], ["1", "2", "3"]);
	});

	it("exposes the column count the grid should render", () => {
		assert.equal(columnCount(parseCsv("a,b,c\n1,2,3", ",")), 3);
		// A row wider than the header widens the grid instead of losing cells.
		assert.equal(columnCount(parseCsv("a,b\n1,2,3", ",")), 3);
	});

	it("does not treat an apostrophe as an escape character", () => {
		// Real titles: "Filler - Uta's Past", "Buggy's Crew Adventure Chronicles"
		const result = parseCsv("Title;Start Log\n\"Filler - Uta's Past\";2023-07-11T21:56:00", ";");
		assert.equal(result.rows[0]![0], "Filler - Uta's Past");
	});

	it("keeps wikilink brackets intact", () => {
		const result = parseCsv('a,b\n"[[👤Ju]]",2', ",");
		assert.equal(result.rows[0]![0], "[[👤Ju]]");
	});

	it("returns empty headers for an empty file", () => {
		const result = parseCsv("", ",");
		assert.deepEqual(result.headers, []);
		assert.deepEqual(result.rows, []);
	});
});

describe("stringifyCsv", () => {
	it("round-trips a parsed table byte-for-byte", () => {
		const text = 'a,b\n1,"x,y"\n2,"has""quote"';
		assert.equal(stringifyCsv(parseCsv(text, ","), ","), text);
	});

	it("round-trips a file without a trailing newline", () => {
		// 137 of the vault's 1097 files have no trailing newline; saving must
		// not append one and turn a no-op edit into a whole-file diff.
		const text = "a,b\n1,2";
		assert.equal(stringifyCsv(parseCsv(text, ","), ","), text);
	});

	it("quotes only fields that need it", () => {
		const result = stringifyCsv(
			{ headers: ["a", "b"], rows: [["plain", "has,comma"]], raggedRows: [] },
			",",
		);
		assert.equal(result, 'a,b\nplain,"has,comma"\n');
	});

	it("does not quote apostrophes", () => {
		const result = stringifyCsv(
			{ headers: ["a"], rows: [["Filler - Uta's Past"]], raggedRows: [] },
			",",
		);
		assert.equal(result, "a\nFiller - Uta's Past\n");
	});

	it("quotes fields containing the delimiter, quotes, or newlines", () => {
		const result = stringifyCsv(
			{
				headers: ["a", "b", "c", "d"],
				rows: [["x;y", 'has"quote', "line1\nline2", "tab	here"]],
				raggedRows: [],
			},
			";",
		);
		assert.equal(result, 'a;b;c;d\n"x;y";"has""quote";"line1\nline2";tab	here\n');
	});

	it("writes CRLF when the source used it", () => {
		const text = "a,b\r\n1,2\r\n";
		const table = parseCsv(text, ",");
		assert.equal(stringifyCsv(table, ","), text);
	});
});

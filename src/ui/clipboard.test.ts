import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	copyToClipboard,
	isMarkdownTable,
	parseMarkdownTable,
	cutToClipboard,
	clearCells,
	serializeSelection,
	parseClipboardGrid,
	canPasteGrid,
	pasteGrid,
	fillSelection,
} from "./clipboard.ts";
import type { CsvTable } from "../parser/csv.ts";
import type { Focus } from "./navigation.ts";

function tableOf(headers: string[], rows: string[][]): CsvTable {
	return { headers, rows, raggedRows: [], eol: "\n", trailingNewline: true };
}

const grid = tableOf(["a", "b", "c"], [
	["1", "2", "3"],
	["4", "5", "6"],
	["7", "8", "9"],
]);

describe("serializeSelection", () => {
	it("copies a single cell as one line", () => {
		assert.equal(serializeSelection(grid, [{ row: 0, col: 0 }]), "1");
	});

	it("copies a horizontal run as one tab-separated line", () => {
		assert.equal(serializeSelection(grid, [{ row: 0, col: 0 }, { row: 0, col: 1 }]), "1\t2");
	});

	it("copies a vertical run as one value per line", () => {
		assert.equal(serializeSelection(grid, [{ row: 0, col: 0 }, { row: 1, col: 0 }]), "1\n4");
	});

	it("copies a rectangle in reading order", () => {
		const cells: Focus[] = [
			{ row: 0, col: 0 }, { row: 0, col: 1 },
			{ row: 1, col: 0 }, { row: 1, col: 1 },
		];
		assert.equal(serializeSelection(grid, cells), "1\t2\n4\t5");
	});

	it("serialises the bounding rectangle, not only the chosen cells", () => {
		// A sparse selection still pastes as a full rectangle so columns line up;
		// the gap carries whatever the table holds there.
		assert.equal(
			serializeSelection(grid, [{ row: 0, col: 0 }, { row: 1, col: 1 }]),
			"1\t2\n4\t5",
		);
	});

	it("uses CRLF-free plain newlines", () => {
		assert.equal(serializeSelection(grid, [{ row: 0, col: 0 }, { row: 1, col: 0 }]), "1\n4");
	});

	it("handles a selection whose top row is not row 0", () => {
		const cells: Focus[] = [{ row: 2, col: 0 }, { row: 2, col: 1 }];
		assert.equal(serializeSelection(grid, cells), "7\t8");
	});
});

describe("parseClipboardGrid", () => {
	it("reads a single value", () => {
		assert.deepEqual(parseClipboardGrid("hello"), [["hello"]]);
	});

	it("splits on tabs for columns", () => {
		assert.deepEqual(parseClipboardGrid("a\tb\tc"), [["a", "b", "c"]]);
	});

	it("splits on newlines for rows", () => {
		assert.deepEqual(parseClipboardGrid("a\tb\nc\td"), [["a", "b"], ["c", "d"]]);
	});

	it("normalises CRLF", () => {
		assert.deepEqual(parseClipboardGrid("a\tb\r\nc\td"), [["a", "b"], ["c", "d"]]);
	});

	it("keeps an empty cell as an empty string", () => {
		assert.deepEqual(parseClipboardGrid("a\t\tc"), [["a", "", "c"]]);
	});

	it("treats a trailing newline as ending the last row, not adding one", () => {
		assert.deepEqual(parseClipboardGrid("a\tb\n"), [["a", "b"]]);
	});

	it("returns nothing for empty text", () => {
		assert.deepEqual(parseClipboardGrid(""), []);
	});

	it("reads a quoted multi-line value", () => {
		// Excel and Sheets quote a cell that contains a line break, and the break
		// stays inside that cell instead of starting a row.
		assert.deepEqual(parseClipboardGrid('"line1\nline2"\td'), [
			["line1\nline2", "d"],
		]);
	});

	it("keeps a tab inside a quoted cell", () => {
		assert.deepEqual(parseClipboardGrid('"a\tb"\tc'), [["a\tb", "c"]]);
	});

	it("un-escapes a doubled quote inside a quoted cell", () => {
		assert.deepEqual(parseClipboardGrid('"say ""hi"""\tb'), [['say "hi"', "b"]]);
	});
});

describe("canPasteGrid", () => {
	it("accepts a plain multi-cell paste", () => {
		assert.equal(canPasteGrid("a\tb\nc\td", 2, 2), true);
	});

	it("accepts a single cell pasted into a multi-cell selection", () => {
		assert.equal(canPasteGrid("x", 3, 4), true);
	});

	it("rejects empty text", () => {
		assert.equal(canPasteGrid("", 1, 1), false);
	});

	it("rejects whitespace-only text", () => {
		assert.equal(canPasteGrid("   \n  ", 2, 2), false);
	});
});

describe("clearCells", () => {
	it("blanks a single cell", () => {
		const out = clearCells(grid, [{ row: 0, col: 1 }]);
		assert.deepEqual(out.rows[0], ["1", "", "3"]);
	});

	it("blanks a rectangle", () => {
		const cells: Focus[] = [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }];
		const out = clearCells(grid, cells);
		assert.deepEqual(out.rows[0], ["", "", "3"]);
		assert.deepEqual(out.rows[1], ["", "", "6"]);
	});

	it("leaves unselected rows alone", () => {
		const out = clearCells(grid, [{ row: 1, col: 0 }]);
		assert.deepEqual(out.rows[0], ["1", "2", "3"]);
		assert.deepEqual(out.rows[2], ["7", "8", "9"]);
	});

	it("does not mutate the original table", () => {
		clearCells(grid, [{ row: 0, col: 0 }]);
		assert.deepEqual(grid.rows[0], ["1", "2", "3"]);
	});

	it("clears a column that is ragged in places", () => {
		const ragged: CsvTable = {
			headers: ["a", "b"],
			rows: [["1"], ["2", "3"]],
			raggedRows: [0],
			eol: "\n",
			trailingNewline: true,
		};
		const out = clearCells(ragged, [{ row: 0, col: 1 }, { row: 1, col: 1 }]);
		assert.deepEqual(out.rows[0], ["1", ""]);
		assert.deepEqual(out.rows[1], ["2", ""]);
	});

	it("ignores a cell outside the table", () => {
		const out = clearCells(grid, [{ row: 99, col: 99 }]);
		assert.deepEqual(out.rows, grid.rows);
	});
});

describe("copyToClipboard", () => {
	it("copies the selection as a Markdown table", () => {
		assert.equal(
			copyToClipboard(grid, [{ row: 0, col: 0 }, { row: 0, col: 1 }]),
			"| 1 | 2 |\n| --- | --- |",
		);
	});

	it("copies a two-row selection with the delimiter after the header", () => {
		assert.equal(
			copyToClipboard(grid, [
				{ row: 0, col: 0 }, { row: 0, col: 1 },
				{ row: 1, col: 0 }, { row: 1, col: 1 },
			]),
			"| 1 | 2 |\n| --- | --- |\n| 4 | 5 |",
		);
	});

	it("copies an empty selection as empty text", () => {
		assert.equal(copyToClipboard(grid, []), "");
	});

	it("escapes a pipe so it is not read as a column separator", () => {
		assert.equal(
			copyToClipboard(grid, [{ row: 0, col: 0 }]),
			"| 1 |\n| --- |",
		);
		const piped = {
			headers: ["a"], rows: [["x|y"]], raggedRows: [],
			eol: "\n", trailingNewline: true,
		};
		assert.equal(
			copyToClipboard(piped, [{ row: 0, col: 0 }]),
			"| x\\|y |\n| --- |",
		);
	});
});

describe("isMarkdownTable", () => {
	it("accepts the output of copyToClipboard", () => {
		assert.equal(isMarkdownTable(copyToClipboard(grid, [
			{ row: 0, col: 0 }, { row: 0, col: 1 },
		])), true);
	});

	it("rejects TSV from a spreadsheet", () => {
		assert.equal(isMarkdownTable("1\t2"), false);
	});

	it("rejects a single pipe with no delimiter row", () => {
		assert.equal(isMarkdownTable("| a | b |"), false);
	});

	it("rejects prose that merely starts with a pipe", () => {
		assert.equal(isMarkdownTable("| quoted text | more text"), false);
	});

	it("ignores a trailing newline when judging the table", () => {
		assert.equal(isMarkdownTable("| a | b |\n| --- | --- |\n| c | d |\n"), true);
	});

	it("rejects a line that only ends in a pipe", () => {
		assert.equal(isMarkdownTable("a | b |\n| --- | --- |"), false);
	});
});

describe("parseMarkdownTable", () => {
	it("round-trips through copyToClipboard", () => {
		const cells = [
			{ row: 0, col: 0 }, { row: 0, col: 1 },
			{ row: 1, col: 0 }, { row: 1, col: 1 },
		];
		const text = copyToClipboard(grid, cells);
		assert.deepEqual(parseMarkdownTable(text), [
			["1", "2"], ["4", "5"],
		]);
	});

	it("skips the delimiter row", () => {
		assert.deepEqual(
			parseMarkdownTable("| a | b |\n| --- | --- |\n| c | d |"),
			[["a", "b"], ["c", "d"]],
		);
	});

	it("unescapes an escaped pipe", () => {
		assert.deepEqual(parseMarkdownTable("| x\\|y |\n| --- |"), [["x|y"]]);
	});

	it("returns an empty grid for a delimiter row only", () => {
		assert.deepEqual(parseMarkdownTable("| --- |"), []);
	});
});

describe("cutToClipboard", () => {
	it("copies the selection as a Markdown table, like copy", () => {
		const result = cutToClipboard(grid, [{ row: 0, col: 0 }, { row: 0, col: 1 }]);
		assert.equal(result.copied, "| 1 | 2 |\n| --- | --- |");
		assert.deepEqual(result.table.rows[0], ["", "", "3"]);
	});

	it("pastes its own cut text back through the same parser", () => {
		const result = cutToClipboard(grid, [{ row: 0, col: 0 }, { row: 0, col: 1 }]);
		assert.equal(isMarkdownTable(result.copied), true);
		assert.deepEqual(parseMarkdownTable(result.copied), [["1", "2"]]);
	});

	it("does not mutate the original table", () => {
		cutToClipboard(grid, [{ row: 0, col: 0 }]);
		assert.deepEqual(grid.rows[0], ["1", "2", "3"]);
	});
});

describe("clipboard operations with hiddenRows (active filter)", () => {
	const filtered = tableOf(["tag", "val", "dst"], [
		["A", "1", "d0"],
		["B", "2", "d1"],
		["A", "3", "d2"],
		["C", "4", "d3"],
		["A", "5", "d4"],
	]);
	const hidden = new Set([1, 3]);

	it("serializeSelection skips hidden rows inside the bounding box", () => {
		const cells: Focus[] = [
			{ row: 0, col: 1 },
			{ row: 2, col: 1 },
			{ row: 4, col: 1 },
		];
		assert.equal(serializeSelection(filtered, cells, hidden), "1\n3\n5");
	});

	it("copyToClipboard omits hidden rows from the Markdown table", () => {
		const cells: Focus[] = [
			{ row: 0, col: 1 },
			{ row: 2, col: 1 },
			{ row: 4, col: 1 },
		];
		assert.equal(
			copyToClipboard(filtered, cells, hidden),
			"| 1 |\n| --- |\n| 3 |\n| 5 |",
		);
	});

	it("cutToClipboard copies and clears only visible rows", () => {
		const cells: Focus[] = [
			{ row: 0, col: 1 },
			{ row: 1, col: 1 },
			{ row: 2, col: 1 },
		];
		const { copied, table } = cutToClipboard(filtered, cells, hidden);
		assert.equal(copied, "| 1 |\n| --- |\n| 3 |");
		assert.equal(table.rows[0]?.[1], "");
		assert.equal(table.rows[1]?.[1], "2"); // hidden row untouched
		assert.equal(table.rows[2]?.[1], "");
	});

	it("pasteGrid writes only onto visible rows, leaving hidden rows untouched", () => {
		const pasted = pasteGrid(
			filtered,
			[["X"], ["Y"], ["Z"]],
			{ row: 0, col: 2 },
			hidden,
		);
		assert.deepEqual(
			pasted.rows.map((r) => r[2]),
			["X", "d1", "Y", "d3", "Z"],
		);
	});

	it("pasteGrid appends new rows when the clipboard has more rows than visible targets", () => {
		const pasted = pasteGrid(
			filtered,
			[["X"], ["Y"], ["Z"], ["W"]],
			{ row: 0, col: 2 },
			hidden,
		);
		assert.equal(pasted.rows.length, 6);
		assert.deepEqual(
			pasted.rows.map((r) => r[2]),
			["X", "d1", "Y", "d3", "Z", "W"],
		);
	});

	it("batch copy and paste round-trips across filtered rows without touching hidden rows", () => {
		const copied = copyToClipboard(
			filtered,
			[{ row: 0, col: 1 }, { row: 2, col: 1 }, { row: 4, col: 1 }],
			hidden,
		);
		const parsed = parseMarkdownTable(copied);
		const pasted = pasteGrid(filtered, parsed, { row: 0, col: 2 }, hidden);
		assert.deepEqual(
			pasted.rows.map((r) => r[2]),
			["1", "d1", "3", "d3", "5"],
		);
	});

	it("fillSelection down and right skip hidden rows", () => {
		const down = fillSelection(
			filtered,
			[{ row: 0, col: 1 }, { row: 4, col: 1 }],
			"down",
			hidden,
		);
		assert.deepEqual(
			down.rows.map((r) => r[1]),
			["1", "2", "1", "4", "1"],
		);

		const right = fillSelection(
			filtered,
			[{ row: 0, col: 1 }, { row: 4, col: 2 }],
			"right",
			hidden,
		);
		assert.deepEqual(
			right.rows.map((r) => r[2]),
			["1", "d1", "3", "d3", "5"],
		);
	});

	it("clearCells ignores hidden rows even if passed in the cell list", () => {
		const out = clearCells(
			filtered,
			[{ row: 0, col: 1 }, { row: 1, col: 1 }, { row: 2, col: 1 }],
			hidden,
		);
		assert.deepEqual(
			out.rows.map((r) => r[1]),
			["", "2", "", "4", "5"],
		);
	});
});
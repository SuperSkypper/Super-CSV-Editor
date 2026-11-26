import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	widestTextsByColumn,
	widestTextInColumn,
	resizeWidth,
	clampColumnWidth,
	mergeWidths,
	GHOST_COLUMN_WIDTH,
	MIN_COLUMN_WIDTH,
} from "./columns.ts";
import type { CsvTable } from "../parser/csv.ts";

function tableOf(headers: string[], rows: string[][]): CsvTable {
	return { headers, rows, raggedRows: [], eol: "\n", trailingNewline: true };
}

describe("widestTextsByColumn", () => {
	it("ignores the header even when the header is wider than the values", () => {
		const texts = widestTextsByColumn(tableOf(["Very Long Title"], [["x"]]));
		assert.deepEqual(texts, ["x"]);
	});

	it("returns the value instead of the header when their display widths tie", () => {
		// Regression: "PLAT" (width 4) previously won the tie over "🎮PC" (width 4),
		// causing the column to measure "PLAT" and clip "🎮PC" to "🎮...".
		const texts = widestTextsByColumn(tableOf(["PLAT"], [["[[🎮PC]]"]]));
		assert.deepEqual(texts, ["🎮PC"]);
	});

	it("returns the longest data cell, not the header", () => {
		const texts = widestTextsByColumn(tableOf(["id"], [["a"], ["abcdefgh"]]));
		assert.deepEqual(texts, ["abcdefgh"]);
	});

	it("returns one text per column", () => {
		const texts = widestTextsByColumn(tableOf(["a", "b", "c"], [["1", "22", "333"]]));
		assert.equal(texts.length, 3);
	});

	it("scans every row, not just the first ones", () => {
		// The longest value lives on row 400; a sampled scan would miss it.
		const rows: string[][] = [];
		for (let i = 0; i < 400; i++) rows.push(["short"]);
		rows.push(["the actual longest value in the whole file"]);
		const texts = widestTextsByColumn(tableOf(["col"], rows));
		assert.deepEqual(texts, ["the actual longest value in the whole file"]);
	});

	it("never truncates: a 455-character cell is returned whole", () => {
		// Vault reality: 05🧾Logs/Logs Personal/2024/2024-07.csv has one.
		const long = "x".repeat(455);
		const texts = widestTextsByColumn(tableOf(["a"], [[long]]));
		assert.equal(texts[0]?.length, 455);
	});

	it("handles a ragged row that is wider than the header", () => {
		const table: CsvTable = {
			headers: ["a", "b"],
			rows: [["1", "2", "three"]],
			raggedRows: [0],
			eol: "\n",
			trailingNewline: true,
		};
		assert.deepEqual(widestTextsByColumn(table), ["1", "2", "three"]);
	});

	it("prefers an emoji-heavy cell over a longer ASCII one", () => {
		// Display width, not .length: 3 emoji render wider than 5 ASCII chars.
		const texts = widestTextsByColumn(tableOf(["a"], [["abcde"], ["🗓️📺✅"]]));
		assert.equal(texts[0], "🗓️📺✅");
	});

	it("ignores invisible marks when judging width", () => {
		const texts = widestTextsByColumn(tableOf(["col"], [["ab‎cd"]]));
		assert.deepEqual(texts, ["abcd"]);
	});

	it("returns an empty list for a table with no columns", () => {
		assert.deepEqual(widestTextsByColumn(tableOf([], [])), []);
	});

	it("returns an empty string for a column whose cells are all empty", () => {
		assert.deepEqual(widestTextsByColumn(tableOf(["a", "b"], [["1"]])), ["1", ""]);
	});

	it("keeps a newline inside the returned text so wrapping can be measured", () => {
		const texts = widestTextsByColumn(tableOf(["a"], [["one\ntwo"]]));
		assert.equal(texts[0], "one\ntwo");
	});
});

describe("widestTextInColumn", () => {
	it("returns the widest data value and ignores the header", () => {
		const table = tableOf(["Very Long Title", "PLAT"], [["x", "[[🎮PC]]"], ["xy", ""]]);
		assert.equal(widestTextInColumn(table, 0), "xy");
		assert.equal(widestTextInColumn(table, 1), "🎮PC");
	});

	it("returns an empty string when all data cells in the column are empty", () => {
		const table = tableOf(["NOTE"], [[""], [""]]);
		assert.equal(widestTextInColumn(table, 0), "");
	});
});

describe("resizeWidth", () => {
	it("grows by the dragged delta", () => {
		assert.equal(resizeWidth(200, 40), 240);
	});

	it("shrinks by a negative delta", () => {
		assert.equal(resizeWidth(200, -40), 160);
	});

	it("never goes below the minimum", () => {
		assert.equal(resizeWidth(200, -9999), MIN_COLUMN_WIDTH);
	});

	it("respects custom min and max limits", () => {
		assert.equal(resizeWidth(200, -9999, { min: 100, max: 300 }), 100);
		assert.equal(resizeWidth(200, 9999, { min: 100, max: 300 }), 300);
	});
});

describe("clampColumnWidth", () => {
	it("uses MIN_COLUMN_WIDTH and no max by default", () => {
		assert.equal(clampColumnWidth(10), MIN_COLUMN_WIDTH);
		assert.equal(clampColumnWidth(1200), 1200);
	});

	it("applies custom min and max bounds", () => {
		assert.equal(clampColumnWidth(50, { min: 80, max: 250 }), 80);
		assert.equal(clampColumnWidth(150, { min: 80, max: 250 }), 150);
		assert.equal(clampColumnWidth(500, { min: 80, max: 250 }), 250);
	});

	it("treats max <= 0 as unlimited", () => {
		assert.equal(clampColumnWidth(900, { min: 60, max: 0 }), 900);
	});

	it("allows any non-negative minimum and never lets max fall below min", () => {
		assert.equal(clampColumnWidth(50, { min: 200, max: 100 }), 200);
		assert.equal(clampColumnWidth(5, { min: 10, max: 0 }), 10);
		assert.equal(clampColumnWidth(5, { min: 0, max: 0 }), 5);
	});
});

describe("mergeWidths", () => {
	it("keeps the measured width when nothing was resized", () => {
		const measured = [100, 200];
		assert.deepEqual(mergeWidths(measured, {}), measured);
	});

	it("lets a manual width win over measured", () => {
		assert.deepEqual(mergeWidths([100, 200], { 1: 320 }), [100, 320]);
	});

	it("ignores a manual width for a column that no longer exists", () => {
		assert.deepEqual(mergeWidths([100, 200], { 5: 320 }), [100, 200]);
	});

	it("clamps a stored manual width to the minimum", () => {
		assert.equal(mergeWidths([100], { 0: 1 })?.[0], MIN_COLUMN_WIDTH);
	});
});

describe("GHOST_COLUMN_WIDTH", () => {
	it("is the width of the trailing '+' column", () => {
		// The ghost column must cost the data columns NOTHING: a non-zero band
		// here is what forced a scrollbar on a table whose columns summed to the
		// panel width. applyWidths sets the ghost <col> to 0px and positions the
		// strip over the table edge instead, so this constant is the strip's
		// width, not a budget the data columns pay for.
		assert.equal(GHOST_COLUMN_WIDTH, 34);
	});

	it("is narrower than the minimum column so it can never dominate a column", () => {
		assert.ok(GHOST_COLUMN_WIDTH < MIN_COLUMN_WIDTH);
	});
});

describe("widestTextsByColumn with wikilinks", () => {
	it("measures the alias, not the [[target|alias]] syntax", () => {
		const texts = widestTextsByColumn(
			tableOf(["t"], [["[[Some Very Long Target Name|Short]]"]]),
		);
		// The cell shows "Short"; a measurement of "[[Some Very Long...|Short]]"
		// would make the column much too wide.
		assert.equal(texts[0], "Short");
	});

	it("measures the target when no alias is given", () => {
		const texts = widestTextsByColumn(tableOf(["t"], [["[[Some Movie]]"]]));
		assert.equal(texts[0], "Some Movie");
	});

	it("measures surrounding text joined to the link display", () => {
		const texts = widestTextsByColumn(
			tableOf(["t"], [["Watched [[Movie|Film]] twice"]]),
		);
		assert.equal(texts[0], "Watched Film twice");
	});

	it("measures a wikilink with a heading as target > heading", () => {
		const texts = widestTextsByColumn(tableOf(["t"], [["[[Note#Section]]"]]));
		assert.equal(texts[0], "Note > Section");
	});
});

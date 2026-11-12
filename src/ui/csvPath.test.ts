import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { columnCount, parseCsv, stringifyCsv } from "../parser/csv.ts";
import { NEW_CSV_CONTENT, untitledCsvPath } from "./csvPath.ts";

describe("untitledCsvPath", () => {
	it("uses Untitled.csv when nothing is there", () => {
		assert.equal(untitledCsvPath(() => false), "Untitled.csv");
	});

	it("bumps to Untitled 2.csv, then Untitled 3.csv", () => {
		const taken = (path: string) => path === "Untitled.csv";
		assert.equal(untitledCsvPath(taken), "Untitled 2.csv");
		const taken2 = (path: string) =>
			path === "Untitled.csv" || path === "Untitled 2.csv";
		assert.equal(untitledCsvPath(taken2), "Untitled 3.csv");
	});

	it("starts in the folder it is given", () => {
		assert.equal(untitledCsvPath(() => false, "Notes/Data"), "Notes/Data/Untitled.csv");
	});

	it("treats Obsidian's root path as no folder", () => {
		assert.equal(untitledCsvPath(() => false, "/"), "Untitled.csv");
	});

	it("only counts names in its own folder", () => {
		const taken = (path: string) => path === "Notes/Untitled.csv";
		assert.equal(untitledCsvPath(taken, "Notes"), "Notes/Untitled 2.csv");
		assert.equal(untitledCsvPath(taken, "Other"), "Other/Untitled.csv");
	});
});

describe("NEW_CSV_CONTENT", () => {
	it("parses to one column and one row", () => {
		const table = parseCsv(NEW_CSV_CONTENT, ",");
		assert.equal(columnCount(table), 1);
		assert.equal(table.rows.length, 1);
	});

	it("round-trips unchanged", () => {
		assert.equal(
			stringifyCsv(parseCsv(NEW_CSV_CONTENT, ","), ","),
			NEW_CSV_CONTENT,
		);
	});
});

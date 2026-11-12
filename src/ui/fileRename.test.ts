import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newPathAfterRename, sanitizeFileName } from "./fileRename.ts";

/**
 * The inline title renames the open CSV from the pane, so the path it computes
 * has to match what Obsidian expects: same folder, same extension, and no
 * surprise when the user does (or does not) type the extension.
 */
describe("newPathAfterRename", () => {
	it("keeps the folder and re-applies the extension", () => {
		assert.equal(newPathAfterRename("data/report.csv", "summary"), "data/summary.csv");
	});

	it("does not double an extension the user typed", () => {
		assert.equal(newPathAfterRename("data/report.csv", "summary.csv"), "data/summary.csv");
	});

	it("does not double an uppercase extension", () => {
		assert.equal(newPathAfterRename("data/report.csv", "summary.CSV"), "data/summary.csv");
	});

	it("keeps a root-level file at the root", () => {
		assert.equal(newPathAfterRename("report.csv", "summary"), "summary.csv");
	});

	it("keeps a differently-suffixed name as part of the stem", () => {
		assert.equal(newPathAfterRename("report.csv", "my.report"), "my.report.csv");
	});

	it("trims the name", () => {
		assert.equal(newPathAfterRename("report.csv", "  spaced  "), "spaced.csv");
	});

	it("ignores an empty name", () => {
		assert.equal(newPathAfterRename("data/report.csv", "   "), "data/report.csv");
	});

	it("strips control characters like Obsidian does", () => {
		assert.equal(newPathAfterRename("report.csv", "a\u0000b"), "a b.csv");
	});

	it("handles a folder whose name contains a dot", () => {
		assert.equal(newPathAfterRename("v1.2/report.csv", "summary"), "v1.2/summary.csv");
	});
});

describe("sanitizeFileName", () => {
	it("replaces control characters with a space", () => {
		assert.equal(sanitizeFileName("a\tb\nc"), "a b c");
	});

	it("trims leading and trailing whitespace", () => {
		assert.equal(sanitizeFileName("  name  "), "name");
	});
});

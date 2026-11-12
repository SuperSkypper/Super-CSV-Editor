import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCsvPath, csvGuardMessage } from "./guard.ts";

/**
 * The view extends FileView, which means Obsidian will happily hand it ANY file
 * and the view will write back through vault.modify(). A wikilink opened from a
 * cell was therefore being parsed and re-serialised as CSV, which destroyed the
 * target note's frontmatter. Every one of these guards exists because of that.
 */
describe("isCsvPath", () => {
	it("accepts a plain csv path", () => {
		assert.equal(isCsvPath("logs/2026-01.csv"), true);
	});

	it("accepts a csv in a folder with dots and spaces", () => {
		assert.equal(isCsvPath("03🎮Games & Media/2022/{2022} 🗯 Dice 🗓️26✅.csv"), true);
	});

	it("accepts an uppercase extension", () => {
		assert.equal(isCsvPath("DATA.CSV"), true);
	});

	it("rejects a markdown note", () => {
		assert.equal(isCsvPath("notes/One Piece.md"), false);
	});

	it("rejects a markdown note even when its name ends in csv", () => {
		assert.equal(isCsvPath("notes/fake.csv.md"), false);
	});

	it("rejects a file with no extension", () => {
		assert.equal(isCsvPath("README"), false);
	});

	it("rejects a tsv, which this view does not handle", () => {
		assert.equal(isCsvPath("data.tsv"), false);
	});

	it("rejects an empty path", () => {
		assert.equal(isCsvPath(""), false);
	});

	it("rejects a directory-looking path", () => {
		assert.equal(isCsvPath("folder.csv/notes.md"), false);
	});
});

describe("csvGuardMessage", () => {
	it("names the offending file", () => {
		const msg = csvGuardMessage("notes/One Piece.md");
		assert.match(msg, /One Piece\.md/);
	});

	it("explains that the file was left untouched", () => {
		const msg = csvGuardMessage("notes/One Piece.md");
		assert.match(msg, /left unchanged|no changes were written/i);
	});
});
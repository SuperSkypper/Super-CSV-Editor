import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDisplayValue, stripInvisible, cellDisplayWidth } from "./format.ts";

// Vault reality: 516 U+200E marks in headers, emoji column names, and very long
// titles. Rendering must not be thrown off by invisible characters.
describe("stripInvisible", () => {
	it("removes LTR and RTL marks", () => {
		assert.equal(stripInvisible("Start Log‎‏"), "Start Log");
	});

	it("removes LRE and PDF marks", () => {
		assert.equal(stripInvisible("‪Start Log‬"), "Start Log");
	});

	it("removes the BOM", () => {
		assert.equal(stripInvisible("﻿Title"), "Title");
	});

	it("keeps normal characters untouched", () => {
		assert.equal(stripInvisible("Filler - Uta's Past"), "Filler - Uta's Past");
	});

	it("keeps emoji and accents", () => {
		assert.equal(stripInvisible("🗓️ Ação"), "🗓️ Ação");
	});
});

describe("cellDisplayWidth", () => {
	it("counts a plain ASCII string once per character", () => {
		assert.equal(cellDisplayWidth("abc"), 3);
	});

	it("counts an emoji as more than one column", () => {
		assert.ok(cellDisplayWidth("🗓️") >= 2);
	});

	it("returns zero for an empty cell", () => {
		assert.equal(cellDisplayWidth(""), 0);
	});

	it("ignores invisible marks when measuring", () => {
		assert.equal(cellDisplayWidth("ab‎cd"), 4);
	});
});

describe("formatDisplayValue", () => {
	it("rewrites a full ISO datetime with T separator", () => {
		assert.equal(formatDisplayValue("2026-08-27T22:33:01"), "2026/08/27 22:33:01");
	});

	it("rewrites a datetime with a zone suffix", () => {
		assert.equal(formatDisplayValue("2026-08-27T22:33:01Z"), "2026/08/27 22:33:01");
	});

	it("rewrites a datetime with milliseconds", () => {
		assert.equal(formatDisplayValue("2026-08-27T22:33:01.123Z"), "2026/08/27 22:33:01");
	});

	it("rewrites a datetime without seconds", () => {
		assert.equal(formatDisplayValue("2026-08-27T22:33"), "2026/08/27 22:33");
	});

	it("rewrites a plain date to slash form", () => {
		assert.equal(formatDisplayValue("2022-05-08"), "2022/05/08");
	});

	it("leaves a plain duration like 00h 30m untouched", () => {
		assert.equal(formatDisplayValue("00h 30m"), "00h 30m");
	});

	it("leaves ordinary text untouched", () => {
		assert.equal(formatDisplayValue("Attack on Titan"), "Attack on Titan");
	});

	it("leaves an empty string untouched", () => {
		assert.equal(formatDisplayValue(""), "");
	});

	it("does not rewrite a wikilink value", () => {
		assert.equal(formatDisplayValue("[[2026-08-27T22:33:01]]"), "[[2026-08-27T22:33:01]]");
	});
});

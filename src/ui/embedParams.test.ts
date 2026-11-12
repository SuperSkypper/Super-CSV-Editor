import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRowLimit } from "./embedParams.ts";

/**
 * `![[file.csv|5]]` reaches the plugin as an ALIAS, not as a parameter:
 * Obsidian splits the linktext on the first `|` ({href, title, isAlias}) and
 * renders the alias into the container's `alt` attribute. A note that embeds
 * its CSV with a readable alias must still render every row.
 */
describe("parseRowLimit", () => {
	it("returns null when there is no alias", () => {
		assert.equal(parseRowLimit(null), null);
		assert.equal(parseRowLimit(""), null);
		assert.equal(parseRowLimit("   "), null);
	});

	it("returns null when the alias is not a number", () => {
		assert.equal(parseRowLimit("Absurd Planet"), null);
		assert.equal(parseRowLimit("rows=5"), null);
	});

	it("reads a plain row count", () => {
		assert.equal(parseRowLimit("5"), 5);
		assert.equal(parseRowLimit("1"), 1);
		assert.equal(parseRowLimit("100"), 100);
	});

	it("tolerates surrounding whitespace", () => {
		assert.equal(parseRowLimit(" 5 "), 5);
	});

	it("ignores zero and negatives, which would hide everything", () => {
		assert.equal(parseRowLimit("0"), null);
		assert.equal(parseRowLimit("-3"), null);
	});

	it("ignores a fraction, which is not a row boundary", () => {
		assert.equal(parseRowLimit("2.5"), null);
	});
});

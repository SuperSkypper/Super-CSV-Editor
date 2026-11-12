import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitWikilinks, type LinkSegment } from "./wikilinks.ts";

/**
 * The render must never change what is written back to disk, so the strongest
 * test here is that re-joining the segments reproduces the original string.
 */
describe("splitWikilinks", () => {
	it("returns plain text as a single segment", () => {
		assert.deepEqual(splitWikilinks("just text"), [{ kind: "text", value: "just text" }]);
	});

	it("reads a simple wikilink", () => {
		assert.deepEqual(splitWikilinks("[[Note]]"), [
			{ kind: "link", target: "Note", alias: null, display: "Note", value: "[[Note]]" },
		]);
	});

	it("reads an aliased wikilink", () => {
		assert.deepEqual(splitWikilinks("[[Note|shown]]"), [
			{ kind: "link", target: "Note", alias: "shown", display: "shown", value: "[[Note|shown]]" },
		]);
	});

	it("reads a heading link", () => {
			assert.deepEqual(splitWikilinks("[[Note#Section]]"), [
				{
					kind: "link",
					target: "Note",
					alias: null,
					heading: "Section",
					display: "Note > Section",
					value: "[[Note#Section]]",
				},
			]);
		});

	it("reads a block link", () => {
		const seg = splitWikilinks("[[Note#^blockid]]")[0] as LinkSegment;
		assert.equal(seg.target, "Note");
		assert.equal(seg.blockId, "blockid");
		assert.equal(seg.heading, undefined);
	});

	it("reads an alias together with a heading", () => {
		const seg = splitWikilinks("[[Note#Section|shown]]")[0] as LinkSegment;
		assert.equal(seg.heading, "Section");
		assert.equal(seg.alias, "shown");
		assert.equal(seg.display, "shown");
	});

	it("keeps the text around a link", () => {
		const segs = splitWikilinks("see [[Note]] now");
		assert.equal(segs[0]?.value, "see ");
		assert.equal((segs[1] as LinkSegment).target, "Note");
		assert.equal(segs[2]?.value, " now");
	});

	it("handles several links in one cell", () => {
		const targets = splitWikilinks("[[A]] and [[B]]")
			.filter((s) => s.kind === "link")
			.map((s) => s.target);
		assert.deepEqual(targets, ["A", "B"]);
	});

	it("leaves a lone double bracket alone", () => {
		assert.deepEqual(splitWikilinks("a [[ b"), [{ kind: "text", value: "a [[ b" }]);
	});

	it("leaves an empty pair alone", () => {
		assert.deepEqual(splitWikilinks("[[]]"), [{ kind: "text", value: "[[]]" }]);
	});

	it("does not treat a markdown link as a wikilink", () => {
		assert.deepEqual(splitWikilinks("[text](url)"), [
			{ kind: "text", value: "[text](url)" },
		]);
	});

	it("keeps a title containing an apostrophe intact", () => {
		const seg = splitWikilinks("[[Uta's Past]]")[0] as LinkSegment;
		assert.equal(seg.target, "Uta's Past");
	});

	it("keeps a title containing a comma intact", () => {
		// Vault reality: {1958} Superman's Girl Friend, Lois Lane
		const seg = splitWikilinks("[[Superman's Girl Friend, Lois Lane]]")[0] as LinkSegment;
		assert.equal(seg.target, "Superman's Girl Friend, Lois Lane");
	});

	it("keeps a title containing a slash, as in game paths", () => {
		const seg = splitWikilinks("[[03🎮Games/One Piece]]")[0] as LinkSegment;
		assert.equal(seg.target, "03🎮Games/One Piece");
	});

	it("ignores a newline inside the brackets", () => {
		assert.deepEqual(splitWikilinks("[[a\nb]]"), [{ kind: "text", value: "[[a\nb]]" }]);
	});

	it("returns nothing for an empty cell", () => {
		assert.deepEqual(splitWikilinks(""), []);
	});

	it("takes the alias from the LAST pipe, so a title may contain one", () => {
		const seg = splitWikilinks("[[A|B|shown]]")[0] as LinkSegment;
		assert.equal(seg.target, "A|B");
		assert.equal(seg.alias, "shown");
	});

	it("rejoins to the exact original text", () => {
		for (const raw of [
			"[[A]]",
			"x [[A]] y",
			"[[A|b]] [[C#d]]",
			"no links",
			"[[A|B|C]]",
			"[[Note#^abc]]",
			"",
		]) {
			assert.equal(splitWikilinks(raw).map((s) => s.value).join(""), raw);
		}
	});
});

describe("Segment display text", () => {
	it("uses the target when there is no alias", () => {
		const seg = splitWikilinks("[[Note]]")[0] as LinkSegment;
		assert.equal(seg.display, "Note");
	});

	it("uses the alias when there is one", () => {
		const seg = splitWikilinks("[[Note|shown]]")[0] as LinkSegment;
		assert.equal(seg.display, "shown");
	});

	it("shows the heading alongside the target", () => {
		const seg = splitWikilinks("[[Note#Section]]")[0] as LinkSegment;
		assert.equal(seg.display, "Note > Section");
	});
});
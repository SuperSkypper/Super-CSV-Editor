import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applySuggestion,
	findWikiTrigger,
	linktextFor,
	rankCandidates,
	type LinkCandidate,
} from "./linkSuggest.ts";

describe("findWikiTrigger", () => {
	it("triggers right after an opening [[", () => {
		const t = findWikiTrigger("[[", 2);
		assert.deepEqual(t, { start: 0, query: "", closed: false });
	});

	it("reports the query typed so far", () => {
		const t = findWikiTrigger("see [[Ata", 9);
		assert.equal(t?.query, "Ata");
		assert.equal(t?.start, 4);
	});

	it("does not trigger without an opening [[", () => {
		assert.equal(findWikiTrigger("plain text", 10), null);
	});

	it("does not trigger on a single [", () => {
		assert.equal(findWikiTrigger("[Note", 5), null);
	});

	it("does not re-trigger inside an already closed link", () => {
		// Typing after `[[Note]]` must not open the list again: the next
		// suggestion would nest a link inside a link.
		assert.equal(findWikiTrigger("[[Note]] and more", 17), null);
	});

	it("does not trigger from a [[ on an earlier line", () => {
		assert.equal(findWikiTrigger("[[Note\nsecond line", 18), null);
	});

	it("ignores the caret when it sits before the [[", () => {
		assert.equal(findWikiTrigger("see [[Note", 3), null);
	});

	it("stops suggesting once an alias is being typed", () => {
		// Past `|` the user is naming the link, not browsing notes.
		assert.equal(findWikiTrigger("[[Note|display", 14), null);
	});

	it("uses the LAST [[ when there are two on a line", () => {
		const t = findWikiTrigger("[[A]] [[B", 9);
		assert.equal(t?.query, "B");
		assert.equal(t?.start, 6);
	});
});

describe("linktextFor", () => {
	it("uses the bare basename when it is unique", () => {
		assert.equal(linktextFor({ path: "a/Note.md", basename: "Note" }, false), "Note");
	});

	it("uses the full path when the basename is ambiguous", () => {
		assert.equal(linktextFor({ path: "a/Note.md", basename: "Note" }, true), "a/Note");
	});

	it("does not leave a .md extension in the path form", () => {
		assert.equal(linktextFor({ path: "deep/x/y/Note.md", basename: "Note" }, true), "deep/x/y/Note");
	});
});

describe("rankCandidates", () => {
	const c = (basename: string, path = basename + ".md"): LinkCandidate => ({
		path,
		basename,
		insert: basename,
	});
	const all = [c("Zebra"), c("Apple"), c("Ata"), c("Catalog"), c("Banana", "x/Banana.md")];

	it("lists everything for an empty query", () => {
		assert.equal(rankCandidates(all, "").length, 5);
	});

	it("puts an exact match first", () => {
		assert.equal(rankCandidates(all, "ata")[0]?.basename, "Ata");
	});

	it("ranks prefix matches above infix matches", () => {
		const names = rankCandidates(all, "at").map((x) => x.basename);
		// "Ata" and "Catalog" both contain "at"; the prefix match wins.
		assert.ok(names.indexOf("Ata") < names.indexOf("Catalog"));
	});

	it("filters out non-matching notes", () => {
		const names = rankCandidates(all, "zeb").map((x) => x.basename);
		assert.deepEqual(names, ["Zebra"]);
	});

	it("is case-insensitive", () => {
		assert.equal(rankCandidates(all, "APPLE").length, 1);
	});

	it("matches on the path too", () => {
		assert.equal(rankCandidates(all, "x/ban")[0]?.basename, "Banana");
	});

	it("returns nothing when nothing matches", () => {
		assert.deepEqual(rankCandidates(all, "qqqq"), []);
	});

	it("respects the limit", () => {
		assert.equal(rankCandidates(all, "", 2).length, 2);
	});
});

describe("applySuggestion", () => {
	it("replaces the [[query with a finished link", () => {
		const trigger = findWikiTrigger("see [[Ata", 9);
		assert.ok(trigger);
		const out = applySuggestion("see [[Ata", trigger, "Atari");
		assert.equal(out.value, "see [[Atari]]");
	});

	it("leaves the caret after the closing brackets", () => {
		const trigger = findWikiTrigger("[[At", 4);
		assert.ok(trigger);
		const out = applySuggestion("[[At", trigger, "Atari");
		assert.equal(out.value, "[[Atari]]");
		assert.equal(out.caret, "[[Atari]]".length);
	});

	it("keeps text that followed the caret", () => {
		const trigger = findWikiTrigger("[[At", 4);
		assert.ok(trigger);
		const out = applySuggestion("[[At rest", trigger, "Atari");
		assert.equal(out.value, "[[Atari]] rest");
	});

	it("keeps text before the [[", () => {
		const trigger = findWikiTrigger("watched [[At", 12);
		assert.ok(trigger);
		const out = applySuggestion("watched [[At", trigger, "Atari");
		assert.equal(out.value, "watched [[Atari]]");
	});
});

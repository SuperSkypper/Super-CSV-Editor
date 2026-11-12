import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linkResolution } from "./linkResolution.ts";

/**
 * The rule that decides whether a wikilink reads as unresolved.
 *
 * It is separated from the grid because the two interesting cases are about
 * what to do when the answer is NOT knowable, and those are easy to get wrong
 * in a way no visual check would catch.
 */
describe("linkResolution", () => {
	it("resolves a target the vault knows", () => {
		assert.equal(linkResolution("Atari", "logs.csv", () => ({ path: "Games/Atari.md" })), "resolved");
	});

	it("marks a target the vault does not know as unresolved", () => {
		assert.equal(linkResolution("Typo", "logs.csv", () => null), "unresolved");
	});

	it("treats an empty target as unresolved", () => {
		assert.equal(linkResolution("   ", "logs.csv", () => ({ path: "x.md" })), "unresolved");
	});

	it("stays unknown when there is no source path to resolve against", () => {
		// A grid with no file yet cannot answer; greying every link would be a
		// lie, so nothing is marked.
		assert.equal(linkResolution("Anything", undefined, () => null), "unknown");
	});

	it("stays unknown when there is no resolver", () => {
		assert.equal(linkResolution("Anything", "logs.csv", undefined), "unknown");
	});

	it("passes the source path through to the resolver", () => {
		let seen = null;
		linkResolution("Atari", "deep/folder/logs.csv", (target, source) => {
			seen = { target, source };
			return null;
		});
		assert.deepEqual(seen, { target: "Atari", source: "deep/folder/logs.csv" });
	});
});

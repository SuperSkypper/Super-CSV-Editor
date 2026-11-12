import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findBacklinks, hasBacklinks } from "./backlinks.ts";

/**
 * `findBacklinks` reads `metadataCache.resolvedLinks` backwards.
 *
 * The shape is what Obsidian's metadata cache actually holds: a map keyed by
 * the SOURCE path, whose value maps each target path to a link count. The CSV
 * never appears as a key (CSV sources are not indexed), but it does appear as
 * a target whenever a note links to it — which is exactly the entry these
 * tests build.
 */
function appWith(vaultFiles: string[], resolved: Record<string, Record<string, number>>) {
	// Plain objects, not TFile instances: `findBacklinks` narrows by shape, so
	// importing the obsidian package here would buy nothing and break node:test.
	const files = new Map(
		vaultFiles.map((path) => {
			const name = path.slice(path.lastIndexOf("/") + 1);
			return [
				path,
				{
					path,
					name,
					basename: name.replace(/\.[^.]+$/, ""),
					extension: name.includes(".") ? name.split(".").pop() : "",
				},
			] as const;
		}),
	);
	const app = {
		metadataCache: { resolvedLinks: resolved },
		vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null },
	} as never;
	return app;
}

describe("findBacklinks", () => {
	it("finds the notes linking to the CSV", () => {
		const app = appWith(
			["Notes/Alpha.md", "Notes/Beta.md", "data/table.csv"],
			{
				"Notes/Alpha.md": { "data/table.csv": 1, "Other/Note.md": 1 },
				"Notes/Beta.md": { "data/table.csv": 2 },
			},
		);
		const links = findBacklinks(app, "data/table.csv");
		assert.deepEqual(
			links.map((l) => l.file.path),
			["Notes/Alpha.md", "Notes/Beta.md"],
		);
	});

	it("returns nothing when no note links to the CSV", () => {
		const app = appWith(["Notes/Alpha.md"], { "Notes/Alpha.md": { "Other.md": 1 } });
		assert.deepEqual(findBacklinks(app, "data/table.csv"), []);
	});

	it("does not report the CSV itself as a source", () => {
		// A CSV is never an indexed source, but if one somehow appeared in the
		// map it must not be listed as a backlink: it is not a note.
		const app = appWith(["data/table.csv"], { "data/table.csv": { "data/table.csv": 1 } });
		assert.deepEqual(findBacklinks(app, "data/table.csv"), []);
	});

	it("skips a source that has since been deleted", () => {
		const app = appWith(["Notes/Alpha.md"], {
			"Notes/Gone.md": { "data/table.csv": 1 },
			"Notes/Alpha.md": { "data/table.csv": 1 },
		});
		assert.deepEqual(
			findBacklinks(app, "data/table.csv").map((l) => l.file.path),
			["Notes/Alpha.md"],
		);
	});

	it("counts repeated links from the same note in the label", () => {
		const app = appWith(["Notes/Alpha.md"], { "Notes/Alpha.md": { "data/table.csv": 3 } });
		const links = findBacklinks(app, "data/table.csv");
		assert.equal(links[0]?.label, "Alpha (3)");
	});

	it("shows a plain name for a single link", () => {
		const app = appWith(["Notes/Alpha.md"], { "Notes/Alpha.md": { "data/table.csv": 1 } });
		assert.equal(findBacklinks(app, "data/table.csv")[0]?.label, "Alpha");
	});

	it("sorts by path so the order is stable between runs", () => {
		const app = appWith(["Notes/Zeta.md", "Notes/Alpha.md"], {
			"Notes/Zeta.md": { "data/table.csv": 1 },
			"Notes/Alpha.md": { "data/table.csv": 1 },
		});
		assert.deepEqual(
			findBacklinks(app, "data/table.csv").map((l) => l.file.path),
			["Notes/Alpha.md", "Notes/Zeta.md"],
		);
	});

	it("returns nothing when the cache exposes no resolvedLinks map", () => {
		const app = { metadataCache: {}, vault: { getAbstractFileByPath: () => null } } as never;
		assert.deepEqual(findBacklinks(app, "data/table.csv"), []);
	});

	it("ignores non-markdown sources even when indexed", () => {
		// Defensive: only markdown is ever indexed as a source, so filtering by
		// extension must not hide a legitimate backlink.
		const app = appWith(["assets/report.pdf"], { "assets/report.pdf": { "data/table.csv": 1 } });
		assert.deepEqual(findBacklinks(app, "data/table.csv"), []);
	});
});

describe("hasBacklinks", () => {
	it("is true when a note links to the CSV", () => {
		const app = appWith(["Notes/Alpha.md"], { "Notes/Alpha.md": { "data/table.csv": 1 } });
		assert.equal(hasBacklinks(app, "data/table.csv"), true);
	});

	it("is false when nothing links to the CSV", () => {
		const app = appWith(["Notes/Alpha.md"], { "Notes/Alpha.md": { "Other.md": 1 } });
		assert.equal(hasBacklinks(app, "data/table.csv"), false);
	});
});
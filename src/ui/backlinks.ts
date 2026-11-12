import type { App, TFile } from "obsidian";

/**
 * Whether an abstract file is a markdown note Obsidian would open.
 *
 * A folder has the same `path`/`name` shape as a file, so the extension is
 * what distinguishes them; `undefined` covers a path that no longer exists.
 */
function isMarkdownFile(file: unknown): file is TFile {
	const candidate = file as { extension?: string } | null | undefined;
	return candidate !== null && candidate !== undefined && candidate.extension === "md";
}

/**
 * Notes that link to a given file.
 *
 * This is the reverse of the CSV's own outgoing links. The core Backlinks pane
 * cannot show these for a .csv: it reads `metadataCache.resolvedLinks`, and
 * Obsidian only indexes markdown *sources*, so nothing in there ever points at
 * a CSV. The links themselves ARE indexed, though — a note containing
 * `[[table.csv]]` has an entry in `resolvedLinks` whose key is that CSV's
 * path. Reading that map backwards is what surfaces the backlinks.
 *
 * Links from other CSVs are not reported: the CSV-to-CSV direction is not
 * indexed at all (a CSV source has no `resolvedLinks` entry either), so a
 * `[[other.csv]]` in a CSV would be invisible here and the list would look
 * complete when it is not.
 *
 * An `![[table.csv]]` embed DOES land in this map — Obsidian's own Backlinks
 * pane filters embeds out afterwards, but the resolved-links index records them,
 * so a note that only embeds the CSV still shows up here. That is deliberate:
 * an embed is a real dependency on the file.
 */
export function findBacklinks(
	app: App,
	sourcePath: string,
): Array<{ file: TFile; label: string }> {
	const cache = app.metadataCache as unknown as {
		resolvedLinks?: Record<string, Record<string, number>>;
	};
	const resolved = cache.resolvedLinks;
	if (!resolved) return [];

	// The map is keyed by the SOURCE path, and each entry lists that source's
	// link targets. A note linking to `[[table.csv]]` therefore appears as
	// `resolved["Notes/Alpha.md"]["data/table.csv"]`, so the CSV's backlinks are
	// found by scanning every entry for one whose targets include this path —
	// there is no index keyed by target to look it up in.
	const results: Array<{ file: TFile; label: string }> = [];
	for (const [source, targets] of Object.entries(resolved)) {
		const count = targets[sourcePath];
		if (!count) continue;
		const file = app.vault.getAbstractFileByPath(source);
		// Only a note can be an indexed source, and it must still exist. A
		// folder shares the TAbstractFile shape, so the extension is what
		// narrows it to a file Obsidian would open. The check is on the shape
		// rather than `instanceof TFile` so this module stays free of a runtime
		// dependency on the obsidian package.
		if (!isMarkdownFile(file)) continue;
		const label = count > 1 ? `${file.basename} (${count})` : file.basename;
		results.push({ file, label });
	}

	// A stable order beats the object's key order, which follows insertion.
	results.sort((a, b) => a.file.path.localeCompare(b.file.path));
	return results;
}

/**
 * Whether any note links to the CSV.
 *
 * Cheap enough to call for a status bar or a menu's enabled state, because it
 * stops at the first hit instead of building the whole list.
 */
export function hasBacklinks(app: App, sourcePath: string): boolean {
	const cache = app.metadataCache as unknown as {
		resolvedLinks?: Record<string, Record<string, number>>;
	};
	const resolved = cache.resolvedLinks;
	if (!resolved) return false;
	return Object.values(resolved).some((targets) => Boolean(targets[sourcePath]));
}
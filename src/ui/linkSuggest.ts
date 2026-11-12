/**
 * `[[` autocomplete inside a cell editor.
 *
 * Obsidian's own suggest machinery does not fit here. `EditorSuggest` only
 * works on an Obsidian `Editor`, and `AbstractInputSuggest` only accepts an
 * `<input>` or a contenteditable element — the cell editor is a plain
 * `<textarea>`, so neither can drive it. The popover is therefore built here
 * against the textarea directly, while the *data* still comes from Obsidian
 * (`vault.getFiles()` + `metadataCache.getFirstLinkpathDest`), so suggestions
 * resolve exactly like the editor's do.
 *
 * The parsing below is pure so the trigger and filter rules are unit-testable
 * without a DOM.
 */

/** What the user has typed after an opening `[[`, up to the caret. */
export interface WikiTrigger {
	/** Index of the first `[` of the `[[` in the textarea value. */
	start: number;
	/** The query between `[[` and the caret. */
	query: string;
	/** The `[[` closes before the caret, so this `[[` is already a link. */
	closed: boolean;
}

/**
 * Finds an open `[[` before `caret`.
 *
 * Only the text on the CURRENT LINE before the caret is scanned: a `[[` on an
 * earlier line must not trigger, and a link that is already closed (`[[x]]`)
 * must not either — otherwise typing after a finished link reopens the popover
 * and the next suggestion would nest a link inside a link.
 */
export function findWikiTrigger(value: string, caret: number): WikiTrigger | null {
	const before = value.slice(0, caret);
	const lineStart = before.lastIndexOf("\n") + 1;
	const line = before.slice(lineStart);

	const open = line.lastIndexOf("[[");
	if (open === -1) return null;

	const query = line.slice(open + 2);
	// A newline or a closing bracket before the caret means this is not an open
	// link: `]]` closes it and `[[a]` is already malformed.
	if (query.includes("]") || query.includes("[")) return null;

	// A `|` starts the alias: past it the user is naming the link, not browsing,
	// so suggestions stop instead of filtering on the alias text.
	if (query.includes("|")) return null;

	return { start: lineStart + open, query, closed: false };
}

/** A candidate note, already reduced to what the popover shows. */
export interface LinkCandidate {
	path: string;
	basename: string;
	/** The text inserted between the brackets; `path` when names collide. */
	insert: string;
}

/**
 * Picks the linktext to insert.
 *
 * Mirrors Obsidian: a unique basename is inserted as just `Note`; a basename
 * shared by several files is inserted as the full path, so the link cannot
 * resolve to the wrong note.
 */
export function linktextFor(file: { path: string; basename: string }, ambiguous: boolean): string {
	return ambiguous ? file.path.replace(/\.md$/i, "") : file.basename;
}

/** Ranks candidates against `[[` query text. Empty query lists everything. */
export function rankCandidates(
	candidates: LinkCandidate[],
	query: string,
	limit = 50,
): LinkCandidate[] {
	const q = query.toLowerCase().trim();
	if (!q) return candidates.slice(0, limit);

	const scored: Array<{ c: LinkCandidate; score: number }> = [];
	for (const c of candidates) {
		const base = c.basename.toLowerCase();
		const path = c.path.toLowerCase();
		let score = -1;
		if (base === q) score = 0;
		else if (base.startsWith(q)) score = 1;
		else if (base.includes(q)) score = 2;
		else if (path.includes(q)) score = 3;
		if (score >= 0) scored.push({ c, score });
	}
	// Stable within a score band, so equal matches keep vault order instead of
	// shuffling between keystrokes.
	scored.sort((a, b) => a.score - b.score);
	return scored.slice(0, limit).map((s) => s.c);
}

/**
 * Replaces the `[[query` at `trigger.start` with a finished `[[link]]`.
 *
 * The caret lands AFTER the closing brackets, which is where the user wants to
 * be to keep typing the rest of the cell.
 */
export function applySuggestion(
	value: string,
	trigger: WikiTrigger,
	linktext: string,
): { value: string; caret: number } {
	const before = value.slice(0, trigger.start);
	const after = value.slice(trigger.start + 2 + trigger.query.length);
	const inserted = `[[${linktext}]]`;
	return { value: before + inserted + after, caret: before.length + inserted.length };
}

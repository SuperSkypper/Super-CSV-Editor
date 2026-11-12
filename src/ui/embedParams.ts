/**
 * Parsing the parameters of an `![[file.csv]]` embed.
 *
 * `|5` is NOT delivered as a parameter. Obsidian splits the linktext on the
 * first `|` and calls the rest an "alias" (verified in the app bundle:
 * `{|href: e, title: t, isAlias: i}`), which it then renders into the embed
 * container's `alt` attribute. The only thing the embed factory receives as a
 * real argument is Obsidian's own `#` subpath. So a row limit has to be read
 * from the alias, and anything that is not a plain positive integer is treated
 * as "no limit" — a note that embeds its CSV with a human-readable alias such
 * as `![[log.csv|Season 1]]` must still render every row.
 */

/** How many rows an embed shows, or null for all of them. */
export type RowLimit = number | null;

/**
 * The row limit from an embed alias, or null when the alias is absent or is
 * not a usable count.
 */
export function parseRowLimit(alias: string | null | undefined): RowLimit {
	if (alias === null || alias === undefined) return null;
	const trimmed = alias.trim();
	// Number() accepts "2.5" and "-3"; digits-only rejects both, and rejects
	// "5px"/"rows=5" that Number() would also reject but in a way that would
	// silently differ across engines.
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number.parseInt(trimmed, 10);
	return value > 0 ? value : null;
}
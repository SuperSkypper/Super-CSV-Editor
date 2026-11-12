/**
 * Guards that keep this view away from files that are not CSV.
 *
 * The view is a `FileView`, so Obsidian's file protocol will hand it any file it
 * is asked to open, and the view writes back through `vault.modify()`. Without
 * these guards a wikilink followed from a cell got parsed as CSV and re-serialised
 * over the target note, destroying its frontmatter.
 */

/** The only extension this view may read or write. */
export const CSV_EXTENSION = "csv";

/**
 * True only for a path whose final extension is `.csv`.
 *
 * The extension is taken from the last dot in the BASENAME, so a folder called
 * `data.csv` or a note called `fake.csv.md` cannot slip through.
 */
export function isCsvPath(path: string): boolean {
	const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	const basename = path.slice(slash + 1);
	const dot = basename.lastIndexOf(".");
	if (dot <= 0 || dot === basename.length - 1) return false;
	return basename.slice(dot + 1).toLowerCase() === CSV_EXTENSION;
}

/** Shown when the view is handed something it must not touch. */
export function csvGuardMessage(path: string): string {
	return (
		`Super CSV Editor will not open "${path}": not a .csv file. ` +
		`The file was left unchanged and no changes were written.`
	);
}
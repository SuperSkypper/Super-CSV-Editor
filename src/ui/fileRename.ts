/**
 * The path a file would move to if its name became `name`.
 *
 * Mirrors Obsidian's own `TFile.getNewPathAfterRename`: the file keeps its
 * folder and its extension, so — exactly like the markdown inline title — the
 * user types a bare name ("logs" for "logs.csv") and never the extension.
 *
 * Two deviations from the core helper, both deliberate:
 *   - a name that already ends in the file's extension is not doubled
 *     ("logs.csv" stays "logs.csv", not "logs.csv.csv");
 *   - an empty name is a no-op rather than ".csv".
 */
export function newPathAfterRename(currentPath: string, name: string): string {
	const stem = sanitizeFileName(name);
	if (stem === "") return currentPath;

	const slash = currentPath.lastIndexOf("/");
	const dot = currentPath.lastIndexOf(".");
	const hasExtension = dot > slash;
	const extension = hasExtension ? currentPath.slice(dot + 1) : "";

	const bare =
		extension && stem.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
			? stem.slice(0, -(extension.length + 1))
			: stem;
	const fileName = extension ? `${bare}.${extension}` : bare;

	return slash === -1 ? fileName : `${currentPath.slice(0, slash)}/${fileName}`;
}

/**
 * Strips the control characters Obsidian itself refuses in a file name, and
 * trims the edges — the same normalisation `getNewPathAfterRename` applies.
 */
export function sanitizeFileName(name: string): string {
	// eslint-disable-next-line no-control-regex -- these are the exact chars Obsidian strips
	return name.replace(/[\u0000-\u001F]/g, " ").trim();
}

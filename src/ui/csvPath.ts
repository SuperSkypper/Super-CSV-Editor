import { CSV_EXTENSION } from "./guard.ts";

/** The stem Obsidian gives a new file before it has a name. */
export const NEW_CSV_STEM = "Untitled";

/**
 * A brand-new sheet: one column and one row, both empty.
 *
 * Two blank lines is what one column of "header + one empty record" serialises
 * to — with a single column there is no delimiter to write, so the record is an
 * empty line. The parser reads it back as one header cell plus one data row, so
 * the grid opens on a 1x1 sheet instead of a void with nothing to click.
 */
export const NEW_CSV_CONTENT = "\n\n";

/**
 * The first free `Untitled` name in `folder`.
 *
 * Follows Obsidian's own duplicate numbering ("Untitled", "Untitled 2",
 * "Untitled 3", …) so a new sheet never collides with one already there. The
 * caller supplies `exists` because only the vault knows what is on disk.
 */
export function untitledCsvPath(
	exists: (path: string) => boolean,
	folder = "",
): string {
	// A file the user has open at the vault root reports its folder as "/", so a
	// trailing slash has to go or the path would start with "//".
	const base = folder.replace(/\/+$/, "");
	const candidate = (stem: string): string =>
		base ? `${base}/${stem}.${CSV_EXTENSION}` : `${stem}.${CSV_EXTENSION}`;

	const first = candidate(NEW_CSV_STEM);
	if (!exists(first)) return first;

	let n = 2;
	let path = candidate(`${NEW_CSV_STEM} ${n}`);
	while (exists(path)) {
		n += 1;
		path = candidate(`${NEW_CSV_STEM} ${n}`);
	}
	return path;
}

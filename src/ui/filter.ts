import type { CsvTable } from "../parser/csv.ts";

/**
 * The row indexes a search shows, in file order.
 *
 * A row is kept when ANY of its cells contains the query, matched
 * case-insensitively the way the browser's own find behaves. An empty (or
 * whitespace-only) query matches every row, so clearing the box brings the
 * whole sheet back rather than leaving an empty grid.
 */
export function matchingRowIndexes(table: CsvTable, query: string): number[] {
	const needle = query.trim().toLowerCase();
	const all = table.rows.map((_, index) => index);
	if (needle === "") return all;
	return all.filter((index) =>
		(table.rows[index] ?? []).some((value) => value.toLowerCase().includes(needle)),
	);
}

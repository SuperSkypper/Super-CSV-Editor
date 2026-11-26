import type { CsvTable } from "../parser/csv.ts";

/**
 * The row indexes a search shows, in file order.
 *
 * A row is kept when ANY of its cells (or only the specified `column`, when
 * scoped) contains the query, matched case-insensitively the way the browser's
 * own find behaves. An empty (or whitespace-only) query matches every row, so
 * clearing the box brings the whole sheet back rather than leaving an empty grid.
 */
export function matchingRowIndexes(
	table: CsvTable,
	query: string,
	column?: number | null,
): number[] {
	const needle = query.trim().toLowerCase();
	const all = table.rows.map((_, index) => index);
	if (needle === "") return all;
	if (column !== undefined && column !== null) {
		return all.filter((index) =>
			(table.rows[index]?.[column] ?? "").toLowerCase().includes(needle),
		);
	}
	return all.filter((index) =>
		(table.rows[index] ?? []).some((value) => value.toLowerCase().includes(needle)),
	);
}

import { columnCount, type CsvTable } from "./csv.ts";

/** All edit helpers return a new table; the input is never mutated. */
export function clone(table: CsvTable): CsvTable {
	return {
		headers: [...table.headers],
		rows: table.rows.map((row) => [...row]),
		raggedRows: [...table.raggedRows],
		eol: table.eol,
		trailingNewline: table.trailingNewline,
		rowWidths: table.rowWidths ? [...table.rowWidths] : undefined,
		blankRows: table.blankRows ? [...table.blankRows] : undefined,
	};
}

export function reindexRagged(table: CsvTable, headersWidth: number): CsvTable {
	const raggedRows: number[] = [];
	for (let index = 0; index < table.rows.length; index++) {
		const row = table.rows[index];
		if (!row) continue;
		// A row's real width is the one the parser remembered when it padded the
		// row: a padded row is physically full width, so measuring the arrays
		// directly would hide that it is still short in the file. In-memory
		// tables carry no widths and fall back to the row length.
		const width = table.rowWidths?.[index];
		if ((width ?? row.length) !== headersWidth) raggedRows.push(index);
	}
	return { ...table, raggedRows };
}

export function blankRow(width: number): string[] {
	const row: string[] = new Array<string>(width);
	for (let i = 0; i < width; i++) row[i] = "";
	return row;
}

/**
 * Writes one cell into `table` in place, carrying the per-row bookkeeping with
 * it. `setCell` clones first; the clipboard helpers call this directly so a
 * loop of writes clones the table once instead of once per cell.
 */
export function setCellInPlace(
	table: CsvTable,
	rowIndex: number,
	colIndex: number,
	value: string,
): CsvTable {
	const row = table.rows[rowIndex];
	if (!row) return table;
	row[colIndex] = value;
	// Typing into a line that used to be blank makes it a real record, so it
	// must be written with delimiters instead of as an empty line again.
	if (table.blankRows) {
		table.blankRows = table.blankRows.filter((index) => index !== rowIndex);
	}
	// The row now has real content at colIndex, so the parser's padding must
	// not be trimmed away — widen the remembered width to match.
	if (table.rowWidths && colIndex + 1 > (table.rowWidths[rowIndex] ?? 0)) {
		table.rowWidths[rowIndex] = colIndex + 1;
	}
	return table;
}

export function setCell(
	table: CsvTable,
	rowIndex: number,
	colIndex: number,
	value: string,
): CsvTable {
	const next = setCellInPlace(clone(table), rowIndex, colIndex, value);
	// A pad cell turning into real data un-raggeds the row.
	return reindexRagged(next, next.headers.length);
}

export function insertRow(table: CsvTable, at: number): CsvTable {
	const next = clone(table);
	const index = Math.min(Math.max(at, 0), next.rows.length);
	next.rows.splice(index, 0, blankRow(columnCount(table)));
	// A row the user added has no origin, so it is written at full width; the
	// rows below it keep their own widths and shift down with it.
	next.rowWidths = spliceWidths(next.rowWidths, index, columnCount(table));
	// The new row is a record of empty fields, not one of the file's blank
	// lines, so it must be written with delimiters. Only the flags below it
	// shift down.
	next.blankRows = shiftBlanks(next.blankRows, index);
	// Ragged flags depend on the widths just re-keyed, so they are derived last.
	return reindexRagged(next, next.headers.length);
}

/** Inserts a width at `at`, mirroring the row splice, for a row with no origin. */
function spliceWidths(widths: number[] | undefined, at: number, width: number): number[] | undefined {
	if (!widths) return undefined;
	const next = [...widths];
	next.splice(at, 0, width);
	return next;
}

/** Moves blank flags at or below `at` down one slot, for an inserted row. */
function shiftBlanks(blanks: number[] | undefined, at: number): number[] | undefined {
	if (!blanks) return undefined;
	return blanks.map((index) => (index >= at ? index + 1 : index));
}

export function deleteRow(table: CsvTable, index: number): CsvTable {
	return deleteRows(table, [index]);
}

/** Removes several rows at once; indices need not be sorted or unique. */
export function deleteRows(table: CsvTable, indices: number[]): CsvTable {
	const next = clone(table);
	const doomed = new Set(indices.filter((i) => i >= 0 && i < next.rows.length));
	if (doomed.size === 0) return next;
	const keep = (i: number): boolean => !doomed.has(i);
	next.rows = next.rows.filter((_, i) => keep(i));
	// Widths travel with their row, so the survivors shift down by however many
	// doomed rows came before them.
	if (next.rowWidths) next.rowWidths = next.rowWidths.filter((_, i) => keep(i));
	if (next.blankRows) {
		next.blankRows = next.blankRows
			.filter((i) => keep(i))
			.map((i) => i - countBefore(doomed, i));
	}
	// Derived last, from the re-keyed widths.
	return reindexRagged(next, next.headers.length);
}

/** How many of `doomed` sit strictly before `index`. */
function countBefore(doomed: Set<number>, index: number): number {
	let n = 0;
	for (const i of doomed) if (i < index) n++;
	return n;
}

export function moveRow(table: CsvTable, from: number, to: number): CsvTable {
	const next = clone(table);
	const { rows } = next;
	if (from < 0 || from >= rows.length) return next;
	const target = Math.min(Math.max(to, 0), rows.length - 1);
	if (target === from) return next;
	const [row] = rows.splice(from, 1);
	rows.splice(target, 0, row!);
	next.rowWidths = moveEntry(next.rowWidths, from, target);
	next.blankRows = moveFlag(next.blankRows, from, target);
	// Derived last, from the re-keyed widths.
	return reindexRagged(next, next.headers.length);
}

/** Moves one array slot, returning a copy; undefined stays undefined. */
function moveEntry<T>(list: T[] | undefined, from: number, to: number): T[] | undefined {
	if (!list) return undefined;
	const next = [...list];
	const [entry] = next.splice(from, 1);
	next.splice(to, 0, entry as T);
	return next;
}

/**
 * Moves the blank flag of row `from` so it follows the row to `to`.
 *
 * Returns the list unchanged when the moved row was not blank — inventing a
 * flag for it would make an ordinary short row serialise as an empty line and
 * drop its data on save.
 */
function moveFlag(flags: number[] | undefined, from: number, to: number): number[] | undefined {
	if (!flags) return undefined;
	if (!flags.includes(from)) return flags;
	const others = flags.filter((index) => index !== from);
	return [...others, to].sort((a, b) => a - b);
}

export function insertColumn(
	table: CsvTable,
	at: number,
	header: string,
): CsvTable {
	const next = clone(table);
	const index = Math.min(Math.max(at, 0), next.headers.length);
	next.headers.splice(index, 0, header);
	for (const row of next.rows) row.splice(index, 0, "");
	// Every row gains one real field, so its remembered width grows with it; a
	// short row stays short relative to the wider header and keeps its flag.
	if (next.rowWidths) {
		next.rowWidths = next.rowWidths.map((width) => width + 1);
	}
	return reindexRagged(next, next.headers.length);
}

export function deleteColumn(table: CsvTable, index: number): CsvTable {
	return deleteColumns(table, [index]);
}

/** Removes several columns at once; indices need not be sorted or unique. */
export function deleteColumns(table: CsvTable, indices: number[]): CsvTable {
	const next = clone(table);
	const doomed = new Set(indices.filter((i) => i >= 0 && i < next.headers.length));
	if (doomed.size === 0) return next;
	// Walk from the right so earlier splices cannot shift a later index.
	for (const index of [...doomed].sort((a, b) => b - a)) {
		next.headers.splice(index, 1);
		for (const row of next.rows) row.splice(index, 1);
	}
	// A row loses a field only for a deleted column that sat inside it; a column
	// past its original width was parser padding, which is trimmed on save
	// anyway, so it must not shorten the remembered width.
	if (next.rowWidths) {
		next.rowWidths = next.rowWidths.map((width) => {
			let removed = 0;
			for (const index of doomed) if (index < width) removed++;
			return width - removed;
		});
	}
	return reindexRagged(next, next.headers.length);
}

export function moveColumn(table: CsvTable, from: number, to: number): CsvTable {
	const next = clone(table);
	const { headers, rows } = next;
	if (from < 0 || from >= headers.length) return next;
	const target = Math.min(Math.max(to, 0), headers.length - 1);
	if (target === from) return next;
	const [header] = headers.splice(from, 1);
	headers.splice(target, 0, header!);
	for (const row of rows) {
		if (from < row.length) {
			const [cell] = row.splice(from, 1);
			row.splice(target, 0, cell ?? "");
		}
	}
	return reindexRagged(next, next.headers.length);
}

export function renameColumn(
	table: CsvTable,
	index: number,
	name: string,
): CsvTable {
	const next = clone(table);
	if (index < 0 || index >= next.headers.length) return next;
	next.headers[index] = name;
	return next;
}

export type SortDirection = "asc" | "desc";

/**
 * Sorts the data rows by one column, leaving the header untouched.
 *
 * Values that look like numbers compare numerically — the way a person reads
 * a column of durations or counts — and everything else compares as text.
 * Empty cells sink to the end either way, so a partially filled column still
 * groups its real values together.
 */
export function sortRows(table: CsvTable, col: number, direction: SortDirection): CsvTable {
	const next = clone(table);
	if (col < 0 || col >= next.headers.length) return next;

	const sign = direction === "asc" ? 1 : -1;
	const compare = (a: string[], b: string[]): number => {
		const av = a[col] ?? "";
		const bv = b[col] ?? "";
		// Empty always sinks to the bottom, regardless of direction.
		if (av === "" && bv === "") return 0;
		if (av === "") return 1;
		if (bv === "") return -1;

		const an = Number(av);
		const bn = Number(bv);
		if (!Number.isNaN(an) && !Number.isNaN(bn) && av.trim() !== "" && bv.trim() !== "") {
			return (an - bn) * sign;
		}
		return av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" }) * sign;
	};

	// Each row travels with its own metadata. Sorting the pairs instead of the
	// bare rows keeps a padded row at its original width, and a blank line
	// blank — otherwise the per-row bookkeeping would describe the wrong rows
	// and the next save would rewrite lines the sort did not touch.
	const paired = table.rows.map((row, index) => ({
		row,
		width: table.rowWidths?.[index],
		blank: table.blankRows?.includes(index) ?? false,
	}));
	paired.sort((a, b) => compare(a.row, b.row) || 0);

	next.rows = paired.map(({ row }) => row);
	if (table.rowWidths) next.rowWidths = paired.map(({ width }) => width ?? 0);
	if (table.blankRows) {
		next.blankRows = paired
			.map((entry, index) => (entry.blank ? index : -1))
			.filter((index) => index >= 0);
	}
	// The sorted order changed every row's index, so the ragged flags have to be
	// derived again or they would point at whatever row landed in the old slot.
	return reindexRagged(next, next.headers.length);
}

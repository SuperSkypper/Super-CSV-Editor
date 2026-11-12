export interface CsvTable {
	headers: string[];
	rows: string[][];
	/** Row indexes (0-based, data rows only) that do not match the header width. */
	raggedRows: number[];
	/** Line terminator detected in the source, so saves do not rewrite every line. */
	eol?: string;
	/** Whether the source ended with a line terminator. */
	trailingNewline?: boolean;
	/**
	 * How many fields each data row had in the file it was parsed from.
	 *
	 * The grid works on rectangular rows, so `parseCsv` pads a short row with
	 * empty cells — but those cells are not data, they are the parser's padding,
	 * and writing them back out would append delimiters to a line the user never
	 * touched. Serialisation trims trailing padding back to `rowWidths[i]`, so
	 * opening and closing a file is byte-for-byte a no-op.
	 *
	 * Absent for tables built in memory (a new file, a pasted grid): those rows
	 * are genuinely rectangular and need no trimming.
	 */
	rowWidths?: number[];
	/**
	 * Data rows that were a physically empty line, i.e. a bare EOL with no
	 * fields at all. Kept as their own row so the blank line survives a
	 * round-trip instead of collapsing into a line of delimiters.
	 */
	blankRows?: number[];
}

/** Widest row in the table, so the grid never hides or drops cells. */
export function columnCount(table: CsvTable): number {
	let max = table.headers.length;
	for (const row of table.rows) {
		if (row.length > max) max = row.length;
	}
	return max;
}

export function parseCsv(text: string, delimiter: string): CsvTable {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const trailingNewline = text.endsWith("\n");
	const rows: string[][] = [];
	const field: string[] = [];
	let row: string[] = [];
	let inQuotes = false;
	let i = 0;

	const endField = () => {
		row.push(field.join(""));
		field.length = 0;
	};
	const endRow = () => {
		endField();
		// The guard used to be `row.length === 1 && row[0] === ""`, which cannot
		// tell a blank line in the middle of the file from the newline that ends
		// the last record: both look like one empty field, so a real blank line
		// was silently dropped and the file lost it on save. Position is the
		// only thing that separates them — the final line of the file ends at
		// the end of the source, a blank line ends at a newline.
		const isFinalLine = i >= source.length;
		if (!isFinalLine && row.length === 1 && row[0] === "") {
			rows.push(row);
			row = [];
			return;
		}
		if (isFinalLine && row.length === 1 && row[0] === "") {
			row = [];
			return;
		}
		rows.push(row);
		row = [];
	};

	// Only the final line terminator is stripped. A blank line at the end of the
	// file ("a,b\n1,2\n\n") is real content — it is a row the user left there —
	// and slicing it off before parsing is what used to lose it.
	const source =
		text.endsWith("\n") && !(text.endsWith("\n\n") || text.endsWith("\r\n\r\n"))
			? text.slice(0, text.endsWith("\r\n") ? -2 : -1)
			: text;

	while (i < source.length) {
		const ch = source[i]!;

		if (inQuotes) {
			if (ch === '"') {
				if (source[i + 1] === '"') {
					field.push('"');
					i += 2;
					continue;
				}
				inQuotes = false;
				i += 1;
				continue;
			}
			field.push(ch);
			i += 1;
			continue;
		}

		if (ch === '"' && field.length === 0) {
			inQuotes = true;
			i += 1;
			continue;
		}

		if (ch === delimiter) {
			endField();
			i += 1;
			continue;
		}

		if (ch === "\r" || ch === "\n") {
			endRow();
			if (ch === "\r" && source[i + 1] === "\n") i += 2;
			else i += 1;
			continue;
		}

		field.push(ch);
		i += 1;
	}

	if (field.length > 0 || row.length > 0) endRow();

	const [headers = [], ...dataRows] = rows;
	const raggedRows: number[] = [];
	const padded: string[][] = [];
	const rowWidths: number[] = [];
	const blankRows: number[] = [];
	for (let index = 0; index < dataRows.length; index++) {
		const dataRow = dataRows[index];
		if (!dataRow) continue;
		// A physically blank line has no delimiter at all, so it parses as a
		// single empty field. `",,"` is also all-empty but has three fields —
		// that is a record of empty values, not a blank line, and writing it
		// back must produce the delimiters again.
		if (dataRow.length === 1 && dataRow[0] === "") blankRows.push(index);
		rowWidths.push(dataRow.length);
		if (dataRow.length !== headers.length) {
			raggedRows.push(index);
			if (dataRow.length < headers.length) {
				const filler: string[] = new Array<string>(headers.length - dataRow.length).fill("");
				padded.push([...dataRow, ...filler]);
				continue;
			}
		}
		padded.push(dataRow);
	}

	return {
		headers,
		rows: padded,
		raggedRows,
		eol,
		trailingNewline,
		rowWidths,
		blankRows,
	};
}

function needsQuotes(value: string, delimiter: string): boolean {
	return (
		value.includes(delimiter) ||
		value.includes('"') ||
		value.includes("\n") ||
		value.includes("\r")
	);
}

export function stringifyCsv(
	table: CsvTable,
	delimiter: string,
): string {
	const eol = table.eol ?? "\n";
	const render = (cells: string[]): string =>
		cells
			.map((cell) =>
				needsQuotes(cell, delimiter)
					? `"${cell.replace(/"/g, '""')}"`
					: cell,
			)
			.join(delimiter);

	const widths = table.rowWidths;
	const blanks = table.blankRows ? new Set(table.blankRows) : null;
	const body: string[] = [render(table.headers)];
	for (let index = 0; index < table.rows.length; index++) {
		const row = table.rows[index] ?? [];
		// A line that was blank in the file stays blank. Writing it as a join
		// of empty cells would produce ",,", turning one blank line into noise.
		if (blanks?.has(index)) {
			body.push("");
			continue;
		}
		// Trim only the padding `parseCsv` added. A row the user shortened by
		// hand keeps its trailing empty fields; a row the parser padded is
		// written back at the width it came in with.
		const original = widths?.[index];
		const cells =
			original !== undefined && original < row.length
				? row.slice(0, original)
				: row;
		body.push(render(cells));
	}

	const text = body.join(eol);
	// A file that ended without a newline must not gain one: that would turn a
	// one-cell edit into a whole-file diff.
	return table.trailingNewline === false ? text : text + eol;
}

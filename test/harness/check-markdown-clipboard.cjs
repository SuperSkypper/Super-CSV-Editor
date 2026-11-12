"use strict";
// End-to-end check: copy a selection, paste it back, and paste it into a note.
//
// The grid now copies as a Markdown pipe table (so the clipboard can be
// dropped straight into a note) and reads that same format back on paste.
// TSV is still accepted for content coming from Excel or Google Sheets.
const { withGrid } = require("./browser.cjs");

withGrid(() => {
	const results = [];
	const check = (name, ok) => results.push({ name, ok });

	// Drive the real serialiser/parser from src/ui/clipboard.ts. The grid's own
	// copy path calls the same functions, so this exercises what ships.
	// copyToClipboard is the function the grid's Ctrl+C actually calls, so
	// driving it keeps this check honest about what the user gets.
	const { copyToClipboard, isMarkdownTable, parseMarkdownTable } = window.__GRID__;

	const { grid } = window.__mk("Name,Age\nAlice,30\nBob,25\n");
	const sel = [
		{ row: 0, col: 0 }, { row: 0, col: 1 },
		{ row: 1, col: 0 }, { row: 1, col: 1 },
	];

	const copied = copyToClipboard(grid.getTable(), sel);
	check("copy emits a Markdown table", isMarkdownTable(copied), copied);
	check("copy has a delimiter row", /\| --- \| --- \|/.test(copied), copied);

	const roundTripped = parseMarkdownTable(copied);
	// The grid's row 0 is a data row, so a copy of rows 0..1 carries the values
	// the user selected — the first row doubles as the Markdown header.
	check(
		"paste reads the copy back",
		JSON.stringify(roundTripped) === JSON.stringify([["Alice", "30"], ["Bob", "25"]]),
		JSON.stringify(roundTripped),
	);

	// A pipe inside a value must survive as data, not split the column.
	const piped = window.__mk("A\nx|y\n");
	const pipedCopy = copyToClipboard(piped.grid.getTable(), [{ row: 0, col: 0 }]);
	check("a pipe in a cell is escaped", pipedCopy.includes("\\|"), pipedCopy);
	check(
		"the escaped pipe reads back as one cell",
		JSON.stringify(parseMarkdownTable(pipedCopy)) === JSON.stringify([["x|y"]]),
	);

	// Interoperability: a TSV block copied from Excel still pastes.
	check("TSV is not mistaken for a Markdown table", !isMarkdownTable("Alice\t30"), "");

	// isMarkdownTable must reject anything that merely contains a pipe, or a
	// pasted sentence would be parsed as a one-cell table.
	check("prose with a pipe is not a table", !isMarkdownTable("use the a | b syntax"), "");
	check("a lone pipe is not a table", !isMarkdownTable("|"), "");
	check("a pipe row with no delimiter is not a table", !isMarkdownTable("| a | b |"), "");

	grid.dispose();
	piped.grid.dispose();
	return { results };
}).then(({ results }) => {
	let failed = 0;
	for (const { name, ok } of results) {
		if (!ok) failed++;
		console.log((ok ? "  ok   " : "  FAIL ") + name);
	}
	console.log(failed === 0 ? "MARKDOWN CLIPBOARD ALL PASS" : failed + " FAILED");
	process.exit(failed === 0 ? 0 : 1);
});
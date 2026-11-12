"use strict";
// Regression check for the "clicking a cell selects the whole embed" bug.
//
// In Live Preview, Obsidian renders a `![[file.csv]]` embed and wires
// `hookClickHandler` to it: on click it walks from the click target up to the
// editor's contentDOM, and if it does NOT meet an ancestor matching
// `.cm-editor, .interactive-child`, it calls `selectElement` — which selects
// the embed, recenters the note and reveals the `![[file.csv]]` link, shoving
// the table down. The fix is the same marker Obsidian's own Bases embed uses:
// put `interactive-child` on the embed container.
//
// This drives the REAL `CsvEmbedComponent.loadFile()` (not a copy of the
// handler) and re-runs Obsidian's exact ancestor walk against the DOM it
// produced, so the guard is proven end to end.
const { withGrid } = require("./browser.cjs");

withGrid(async () => {
	const results = [];
	const check = (name, ok) => results.push({ name, ok });

	// Verbatim body of Obsidian's `hookClickHandler` callback (from app.js):
	// returns true when Obsidian would call `selectElement` on this click.
	const wouldSelect = (contentDOM, target) => {
		for (let r = target, o = contentDOM; r && r !== o; r = r.parentNode) {
			if (r instanceof HTMLElement && r.matches(".cm-editor, .interactive-child")) {
				return false;
			}
		}
		return true;
	};

	const CsvEmbedComponent = window.__GRID__.CsvEmbedComponent;
	check("CsvEmbedComponent is exported to the harness", !!CsvEmbedComponent);
	if (!CsvEmbedComponent) return { results };

	const app = window.__APP__;
	app.vault.read = async () => "Name,Note\nalpha,hello\n";
	const plugin = {
		app,
		settings: {
			delimiter: ",",
			embedShowStatusBar: true,
			embedShowAddButtons: true,
			saveDelayMs: 300,
		},
		trackEmbed() {},
		untrackEmbed() {},
	};
	const file = { path: "x.csv", name: "x.csv", basename: "x", extension: "csv" };

	// The Live Preview shape Obsidian builds: contentDOM > internal-embed, and
	// our component is handed the `internal-embed` element.
	const editorWrap = document.createElement("div");
	editorWrap.className = "cm-editor";
	const contentDOM = document.createElement("div");
	contentDOM.className = "cm-content";
	editorWrap.appendChild(contentDOM);
	document.body.appendChild(editorWrap);
	const container = document.createElement("div");
	container.className = "internal-embed";
	contentDOM.appendChild(container);

	const embed = new CsvEmbedComponent(container, plugin, file, { rowLimit: null });
	await embed.loadFile();

	const cell = window.__cell(container, 0, 0);
	check("the embed rendered a grid with cells", !!cell);

	check(
		"the embed container carries `interactive-child`",
		container.classList.contains("interactive-child"),
	);

	// With the guard marker, Obsidian's click-to-select must bail.
	check(
		"Obsidian does NOT select the embed when a cell is clicked",
		cell ? wouldSelect(contentDOM, cell) === false : false,
	);

	// Negative control: strip the class and the very same walk DOES select,
	// proving the check above is not passing for the wrong reason.
	container.classList.remove("interactive-child");
	check(
		"control: without the marker Obsidian WOULD select the embed",
		cell ? wouldSelect(contentDOM, cell) === true : false,
	);
	container.classList.add("interactive-child");

	if (embed.grid) embed.grid.dispose();
	return { results };
}).then(({ results }) => {
	let failed = 0;
	for (const { name, ok } of results) {
		if (!ok) failed++;
		console.log((ok ? "  ok   " : "  FAIL ") + name);
	}
	console.log(
		failed === 0
			? "EMBED INTERACTIVE-CHILD GUARD ALL PASS"
			: failed + " FAILED",
	);
	process.exit(failed === 0 ? 0 : 1);
});

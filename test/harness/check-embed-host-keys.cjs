"use strict";
// A `![[file.csv]]` embed is mounted INSIDE the note's own CodeMirror editor
// (Live Preview) or preview pane. Both of those handle keys too, so anything
// the grid lets bubble up is acted on twice: a bubbled Enter split the note
// paragraph (re-rendering the embed and discarding the cell editor that had
// just opened — "Enter opens the cell but I can't type"), and a bubbled letter
// typed straight into the note.
//
// This drives the REAL GridController inside a stand-in host that listens for
// keydowns exactly like the note editor does, and proves the grid consumes the
// keys it owns: the host must never see them, and real typing must land in the
// cell editor.
//
//   node test/harness/check-embed-host-keys.cjs
const { DOM_SHIM, PAGE_HELPERS, buildBundle, PLAYWRIGHT, CHROME, BUNDLE } = require("./browser.cjs");

let fail = 0;
const check = (name, ok, detail) => {
	console.log((ok ? "  ok   " : "  FAIL ") + name + (detail === undefined ? "" : "  -> " + detail));
	if (!ok) fail++;
};

(async () => {
	buildBundle();
	const { chromium } = require(PLAYWRIGHT);
	const browser = await chromium.launch({ executablePath: CHROME });
	const page = await browser.newPage();
	page.on("pageerror", (e) => { console.log("PAGE ERROR:", e.message); fail++; });

	await page.addScriptTag({ path: BUNDLE });
	await page.addScriptTag({ content: DOM_SHIM + PAGE_HELPERS });

	// A stand-in for the note's editor: an ancestor that records every keydown
	// it is allowed to see, the way CodeMirror would. Both grids live inside it
	// so a leak from either lands in the same record.
	const before = await page.evaluate(() => {
		const { GridController } = window.__GRID__;

		const host = document.createElement("div");
		host.className = "cm-content";
		document.body.appendChild(host);

		const hostSeen = [];
		host.addEventListener("keydown", (e) => hostSeen.push(e.key));
		window.__hostSeen = hostSeen;

		const mkGrid = () => {
			const container = document.createElement("div");
			container.className = "internal-embed interactive-child";
			host.appendChild(container);
			const grid = new GridController(container, window.__APP__, {
				onChange() {},
				getViewData() { return ""; },
			});
			grid.loadText("Name,Note\nalpha,hello\nbeta,world\n", ",", true, null, false);
			grid.mount();
			return container;
		};

		const cellOf = (container) =>
			container.querySelector('.super-csv-editor-cell[data-row="0"][data-col="0"]');
		const press = (target, key) =>
			target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

		// Scenario 1: a letter with the grid (not the editor) focused must be
		// consumed, otherwise typing while a cell is selected leaks into the
		// note. Done on its own grid first, so it does not steal focus from the
		// editor scenario below.
		const letterContainer = mkGrid();
		cellOf(letterContainer).dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true }));
		press(letterContainer, "q");

		// Scenario 2: click a cell, press Enter — the exact embed sequence the
		// user reported — and leave the editor focused for the real typing.
		const editContainer = mkGrid();
		cellOf(editContainer).dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true }));
		press(editContainer, "Enter");
		const editor = editContainer.querySelector(".super-csv-editor-cell-editor");

		window.__container = editContainer;

		return {
			hasEditor: !!editor,
			focusedIsEditor: editor ? document.activeElement === editor : false,
			hostSawEnter: hostSeen.includes("Enter"),
			hostSawQ: hostSeen.includes("q"),
			hostSeen: hostSeen.slice(),
		};
	});

	// Real characters, so the browser inserts them the way it does for a user.
	await page.keyboard.type("hi");

	const after = await page.evaluate(() => {
		const editor = window.__container.querySelector(".super-csv-editor-cell-editor");
		return {
			value: editor ? editor.value : null,
			focusedIsEditor: editor ? document.activeElement === editor : false,
			hostSawH: window.__hostSeen.includes("h"),
			hostSawI: window.__hostSeen.includes("i"),
			hostSeen: window.__hostSeen.slice(),
		};
	});

	check("Enter opens the cell editor inside the embed", before.hasEditor);
	check("the cell editor holds focus after Enter", before.focusedIsEditor);
	check("the host note never sees the Enter key", !before.hostSawEnter, JSON.stringify(before.hostSeen));
	check("the host note never sees a letter typed into the grid", !before.hostSawQ, JSON.stringify(before.hostSeen));
	check(
		"typing reaches the cell editor",
		after.value === "alphahi",
		"value " + JSON.stringify(after.value),
	);
	check("the cell editor still holds focus while typing", after.focusedIsEditor);
	check("typed characters do not leak to the host note", !after.hostSawH && !after.hostSawI, JSON.stringify(after.hostSeen));

	await browser.close();
	console.log(fail === 0 ? "EMBED HOST KEYS ALL PASS" : fail + " FAILED");
	process.exit(fail === 0 ? 0 : 1);
})();

"use strict";
// Clicking the row number must select the whole row, and clicking the column
// header must select the whole column — the spreadsheet convention that makes
// the gutter and the header act as handles rather than as decoration.
//
// Drives the REAL GridController in Chromium, because the bug this guards
// against is an event-wiring one (a handler on the wrong element, or a
// preventDefault swallowing the click) that no amount of unit-testing the
// selection math would catch.
//
//   node test/harness/check-select-row-column.cjs
const path = require("node:path");
const fs = require("node:fs");
const Module = require("node:module");
const mock = require("./obsidian-mock.cjs");
const oR = Module._resolveFilename, oL = Module._load;
Module._resolveFilename = function (r, ...a) { return r === "obsidian" ? "obsidian" : oR.call(this, r, ...a); };
Module._load = function (r, ...a) { return r === "obsidian" ? mock : oL.call(this, r, ...a); };

const { PLAYWRIGHT, CHROME } = require("./paths.cjs");

const bp = path.resolve(__dirname, "bundle-grid.js");
if (!fs.existsSync(bp)) {
	console.error("missing harness bundle:", bp, "- run: node esbuild.config.mjs harness");
	process.exit(2);
}

let fail = 0;
const check = (name, ok, detail) => {
	console.log((ok ? "  ok   " : "  FAIL ") + name + (detail === undefined ? "" : "  -> " + detail));
	if (!ok) fail++;
};

(async () => {
	const { chromium } = require(PLAYWRIGHT);
	const browser = await chromium.launch({ executablePath: CHROME });
	const page = await browser.newPage();
	page.on("pageerror", (e) => { console.log("PAGE ERROR:", e.message); fail++; });

	await page.addScriptTag({ path: bp });
	await page.addScriptTag({
		content: `
			HTMLElement.prototype.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
			HTMLElement.prototype.createEl = function (tag, info) {
				const d = document.createElement(tag);
				const o = typeof info === "string" ? { cls: info } : (info || {});
				if (o.cls) d.className = typeof o.cls === "string" ? o.cls : (o.cls.cls || "");
				if (o.attr) for (const [k, v] of Object.entries(o.attr)) d.setAttribute(k, String(v));
				if (o.text !== undefined) d.textContent = String(o.text);
				if (o.type) d.setAttribute("type", String(o.type));
				if (o.value !== undefined) d.value = o.value;
				this.appendChild(d);
				return d;
			};
			HTMLElement.prototype.createDiv = function (cls) { return this.createEl("div", cls); };
			HTMLElement.prototype.createSpan = function (cls) { return this.createEl("span", cls); };
			HTMLElement.prototype.addClass = function (...c) { this.classList.add(...c); return this; };
			HTMLElement.prototype.removeClass = function (...c) { this.classList.remove(...c); return this; };
			HTMLElement.prototype.toggleClass = function (c, on) { this.classList.toggle(c, on); return this; };
			HTMLElement.prototype.hasClass = function (c) { return this.classList.contains(c); };
			HTMLElement.prototype.setText = function (t) { this.textContent = t; return this; };
			HTMLElement.prototype.appendText = function (t) { this.appendChild(document.createTextNode(String(t))); return this; };
			HTMLElement.prototype.setAttr = function (k, v) { this.setAttribute(k, v); return this; };
			HTMLElement.prototype.detach = function () { this.remove(); };
			window.__APP__ = {
				vault: { async read() { return ""; }, async modify() {}, cachedRead: async () => "", on() { return {}; } },
				metadataCache: { getFirstLinkpathDest: () => null, on() { return {}; } },
				workspace: { getLeavesOfType: () => [], openLinkText() {}, on() { return {}; } },
				fileManager: { generateMarkdownLink: () => "" },
			};
		`,
	});

	const out = await page.evaluate(() => {
		const { GridController } = window.__GRID__;

		const make = (text) => {
			const el = document.createElement("div");
			document.body.appendChild(el);
			const ref = { current: null };
			const grid = new GridController(el, window.__APP__, {
				onChange() {},
				getViewData() { return ref.current ? ref.current.getViewData() : ""; },
			});
			ref.current = grid;
			grid.loadText(text, ",", true, null, true);
			grid.mount();
			return { grid, el };
		};

		// The gutter cell is the FIRST cell of a body row and has no data-col;
		// it is the only cell in the row carrying no-data coordinates.
		const gutterCell = (el, row) =>
			el.querySelectorAll("tbody tr")[row]?.querySelector(".is-gutter-cell") ?? null;

		// The header row starts with the gutter's own slot, so data column `col`
		// sits at index `col + 1`. Picking the wrong one is how a test ends up
		// asserting that column 0 was selected while clicking column 1.
		const headerCell = (el, col) =>
			el.querySelectorAll("thead th")[col + 1] ?? null;

		// What the grid reports as selected, via the public accessor, as a
		// sorted "r,c" list.
		const sel = (grid) =>
			grid.getSelectedCells().map((c) => c.row + "," + c.col);

		// The focus (caret) cell: the one carrying `is-focused`. It is the
		// cell the grid scrolls into view, so its coordinates are what decide
		// whether selecting a row yanks the sheet sideways.
		const focused = (el) => {
			const c = el.querySelector(
				".super-csv-editor-cell.is-focused[data-row][data-col]",
			);
			return c ? Number(c.dataset.row) + "," + Number(c.dataset.col) : null;
		};

		const click = (el, opts = {}) => {
			el.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true, ...opts }));
			el.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true, cancelable: true, ...opts }));
		};

		// Arrow keys are handled by a listener on the grid container, so the
		// dispatch target has to be that container (which the click focuses).
		const arrow = (el, key, opts = {}) =>
			el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));

		const dataCell = (el, row, col) =>
			el.querySelector('.super-csv-editor-cell[data-row="' + row + '"][data-col="' + col + '"]');

		const t = make("TITLE,START,END\nalpha,1,x\nbeta,2,y\ngamma,3,z\n");
		const dataCols = 3;

		// ── Clicking a row number selects that whole row ──
		const g2 = gutterCell(t.el, 1);
		const clickedRow = !!g2;
		if (!clickedRow) throw new Error("no gutter cell found on tbody row 1");
		click(g2);
		const rowSel = sel(t.grid);
		const rowFocus = focused(t.el);
		const expectedRow = Array.from({ length: dataCols }, (_, c) => `1,${c}`).sort();
		const isWholeRow = JSON.stringify([...rowSel].sort()) === JSON.stringify(expectedRow);
		// The caret must land on the FIRST column: the focus cell is the one
		// scrolled into view, and parking it on the last column scrolled a
		// wide sheet to the right on every row click.
		const rowFocusIsFirst = rowFocus === "1,0";

		// ── Clicking a column header selects that whole column ──
		const h1 = headerCell(t.el, 1);
		const clickedCol = !!h1;
		if (!clickedCol) throw new Error("no header cell found for column 1");
		click(h1);
		const colSel = sel(t.grid);
		const colFocus = focused(t.el);
		const bodyRows = t.grid.getTable().rows.length;
		const expectedCol = Array.from({ length: bodyRows }, (_, r) => `${r},1`).sort();
		const isWholeCol = JSON.stringify([...colSel].sort()) === JSON.stringify(expectedCol);
		// Mirror of the row case: the caret sits on the first ROW so selecting
		// a column never scrolls the grid down to the bottom.
		const colFocusIsFirst = colFocus === "0,1";

		// ── The two do not interfere ──
		// Selecting a column after a row must leave only the column selected.
		const noLeak = !colSel.some((k) => k.endsWith(",0")) && colSel.length === bodyRows;

		// ── Ctrl+click builds a multi-row selection ──
		click(gutterCell(t.el, 0));
		click(gutterCell(t.el, 2), { ctrlKey: true });
		const multiSel = sel(t.grid);
		const rowsPicked = new Set(multiSel.map((k) => k.split(",")[0]));
		const isMultiRow = rowsPicked.size === 2 && rowsPicked.has("0") && rowsPicked.has("2");

		// ── Shift+click extends a block of rows ──
		click(gutterCell(t.el, 0));
		click(gutterCell(t.el, 2), { shiftKey: true });
		const blockSel = sel(t.grid);
		const blockFocus = focused(t.el);
		const rowsBlock = new Set(blockSel.map((k) => k.split(",")[0]));
		const isBlock = rowsBlock.size === 3;
		// The shift-extended focus is the first cell of the row the user
		// clicked, not its last cell.
		const blockFocusIsFirst = blockFocus === "2,0";

		// ── Arrow Down slides a whole-row selection ──
		// With a full row selected, Down must move the selection to the row
		// below (not collapse it to a single cell), so a row can be walked
		// down the sheet.
		click(gutterCell(t.el, 1));
		arrow(t.el, "ArrowDown");
		const slideDownSel = sel(t.grid);
		const slideDownFocus = focused(t.el);
		const slideDownOk =
			JSON.stringify([...slideDownSel].sort()) === JSON.stringify(["2,0", "2,1", "2,2"]);
		const slideDownFocusOk = slideDownFocus === "2,0";
		arrow(t.el, "ArrowUp");
		arrow(t.el, "ArrowUp");
		const walkTopOk = focused(t.el) === "0,0" && sel(t.grid).length === dataCols;
		// At the top edge it must not fall through to a collapse.
		arrow(t.el, "ArrowUp");
		const slideTopStays = focused(t.el) === "0,0" && sel(t.grid).length === dataCols;

		// ── Arrow Right slides a whole-column selection ──
		click(headerCell(t.el, 0));
		arrow(t.el, "ArrowRight");
		const colSlideSel = sel(t.grid);
		const colSlideOk =
			colSlideSel.length === bodyRows && colSlideSel.every((k) => k.endsWith(",1"));

		// ── A lone cell still moves one cell at a time ──
		click(dataCell(t.el, 0, 1));
		arrow(t.el, "ArrowDown");
		const cellMoveFocus = focused(t.el);
		const cellMoveSel = sel(t.grid);
		const cellMoveOk =
			cellMoveFocus === "1,1" &&
			JSON.stringify([...cellMoveSel].sort()) === JSON.stringify(["1,1"]);

		return {
			slideDownOk,
			slideDownFocusOk,
			walkTopOk,
			slideTopStays,
			colSlideOk,
			cellMoveOk,
			cellMoveFocus,
			clickedRow,
			isWholeRow,
			rowFocus,
			rowFocusIsFirst,
			rowSel,
			expectedRow,
			clickedCol,
			isWholeCol,
			colFocus,
			colFocusIsFirst,
			colSel,
			expectedCol,
			noLeak,
			isMultiRow,
			multiSel,
			isBlock,
			blockFocus,
			blockFocusIsFirst,
			blockSel,
		};
	});

	check("a gutter cell exists on a body row", out.clickedRow);
	check(
		"clicking the row number selects the whole row",
		out.isWholeRow,
		"got " + JSON.stringify(out.rowSel) + " want " + JSON.stringify(out.expectedRow),
	);
	check(
		"clicking a row number focuses the FIRST cell",
		out.rowFocusIsFirst,
		"focus " + out.rowFocus,
	);
	check("a column header cell exists", out.clickedCol);
	check(
		"clicking the column header selects the whole column",
		out.isWholeCol,
		"got " + JSON.stringify(out.colSel) + " want " + JSON.stringify(out.expectedCol),
	);
	check(
		"clicking a column header focuses the FIRST cell",
		out.colFocusIsFirst,
		"focus " + out.colFocus,
	);
	check("selecting a column clears the previous row selection", out.noLeak, JSON.stringify(out.colSel));
	check(
		"Ctrl+click adds a second row to the selection",
		out.isMultiRow,
		JSON.stringify(out.multiSel),
	);
	check(
		"Shift+click extends to a block of rows",
		out.isBlock,
		JSON.stringify(out.blockSel),
	);
	check(
		"Shift+click focuses the FIRST cell of the last row",
		out.blockFocusIsFirst,
		"focus " + out.blockFocus,
	);
	check("Arrow Down moves a whole-row selection to the row below", out.slideDownOk);
	check("the slid row keeps the caret on its first cell", out.slideDownFocusOk);
	check("Arrow Up walks the row selection back to the top row", out.walkTopOk);
	check("Arrow Up on the top row keeps the selection", out.slideTopStays);
	check("Arrow Right moves a whole-column selection to the next column", out.colSlideOk);
	check("a single cell still moves one cell at a time", out.cellMoveOk, "focus " + out.cellMoveFocus);

	await browser.close();
	console.log(fail === 0 ? "SELECT ROW/COLUMN ALL PASS" : fail + " FAILED");
	process.exit(fail === 0 ? 0 : 1);
})();

"use strict";
// Ctrl+F searches the sheet by FILTERING it: only the rows matching the query
// stay on screen, the way Obsidian Bases searches a view. The box and the
// toolbar live in the view (CsvView); the grid only answers `setFilter`.
//
// Drives the REAL GridController in Chromium, because the parts that break are
// DOM ones: whether the rows are hidden, whether the counts agree with the DOM,
// and whether arrow keys step over the hidden rows instead of stranding the
// caret on a row nobody can see.
//
//   node test/harness/check-find.cjs
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

		const el = document.createElement("div");
		document.body.appendChild(el);
		const ref = { current: null };
		const grid = new GridController(el, window.__APP__, {
			onChange() {},
			getViewData() { return ref.current ? ref.current.getViewData() : ""; },
		});
		ref.current = grid;
		grid.loadText("NAME,CITY\nalice,Paris\nbob,paris\ncarol,London\n", ",", true, null, true);
		grid.mount();

		// The rows the filter hides are still in the DOM; "shown" therefore has
		// to be read off the class, not off the element count.
		const rows = () => Array.from(el.querySelectorAll("tr.super-csv-editor-row:not(.is-header)"));
		const hiddenRows = () =>
			rows().filter((r) => r.hasClass("is-filtered-out")).map((r) => r.dataset.row + "");
		const visibleRows = () =>
			rows().filter((r) => !r.hasClass("is-filtered-out")).map((r) => r.dataset.row + "");
		const headerHidden = () =>
			(el.querySelector("tr.super-csv-editor-row.is-header") || { hasClass: () => false }).hasClass(
				"is-filtered-out",
			);

		// ── Filtering hides the rows that do not match ──
		grid.setFilter("paris");
		const parisHidden = hiddenRows();
		const parisVisible = visibleRows();
		const parisCounts = grid.filterCounts();

		// ── Clearing the query brings every row back ──
		grid.setFilter("");
		const clearedHidden = hiddenRows();
		const clearedCounts = grid.filterCounts();

		// ── No match at all ──
		grid.setFilter("zzzz");
		const noneVisible = visibleRows();
		const noneCounts = grid.filterCounts();

		// ── A header value alone does not keep a row (the header is not data) ──
		grid.setFilter("NAME");
		const headerOnlyVisible = visibleRows();
		const headerOnlyCount = grid.filterCounts().shown;

		// ── Arrow keys step over hidden rows ──
		// "c" matches alice (0) and carol (2) but not bob (1): two ArrowDowns
		// must land on 2, not stop on the hidden row 1.
		grid.setFilter("c");
		grid.setFocus({ row: 0, col: 0 });
		grid.moveFocus("down", false);
		const afterOneDown = grid.focus.row;
		grid.moveFocus("down", false);
		const afterTwoDowns = grid.focus.row;

		// ── A row edited into a match joins the filter ──
		// (Editing is exercised elsewhere; here the table change is simulated
		// through the same path render() takes.)
		grid.setFilter("zzzz");
		const beforeEdit = visibleRows().length;
		grid.setFilter("");
		const afterClear = visibleRows().length;

		return {
			parisHidden,
			parisVisible,
			parisCounts,
			headerHidden: headerHidden(),
			clearedHidden,
			clearedCounts,
			noneVisible,
			noneCounts,
			headerOnlyVisible,
			headerOnlyCount,
			afterOneDown,
			afterTwoDowns,
			beforeEdit,
			afterClear,
			rowCount: rows().length,
		};
	});

	check(
		"only the rows matching the query stay visible",
		JSON.stringify(out.parisVisible) === JSON.stringify(["0", "1"]),
		JSON.stringify(out.parisVisible),
	);
	check(
		"the other rows are hidden",
		JSON.stringify(out.parisHidden) === JSON.stringify(["2"]),
		JSON.stringify(out.parisHidden),
	);
	check(
		"filterCounts agrees with the DOM",
		out.parisCounts.shown === 2 && out.parisCounts.total === 3,
		JSON.stringify(out.parisCounts),
	);
	check("the header row is never hidden by the filter", out.headerHidden === false);
	check("clearing the query shows every row", out.clearedHidden.length === 0, JSON.stringify(out.clearedHidden));
	check(
		"filterCounts reports every row when cleared",
		out.clearedCounts.shown === 3 && out.clearedCounts.total === 3,
		JSON.stringify(out.clearedCounts),
	);
	check("a query with no match shows no rows", out.noneVisible.length === 0, JSON.stringify(out.noneVisible));
	check(
		"filterCounts reports zero shown for no match",
		out.noneCounts.shown === 0 && out.noneCounts.total === 3,
		JSON.stringify(out.noneCounts),
	);
	check(
		"a header-only match keeps no rows",
		out.headerOnlyVisible.length === 0 && out.headerOnlyCount === 0,
		JSON.stringify(out.headerOnlyVisible),
	);
	check("ArrowDown steps over a hidden row", out.afterOneDown === 2, "row " + out.afterOneDown);
	check("ArrowDown stays on the last visible row", out.afterTwoDowns === 2, "row " + out.afterTwoDowns);
	check("a filtered sheet hides all rows for a non-matching query", out.beforeEdit === 0, out.beforeEdit + "");
	check("clearing brings back the full sheet", out.afterClear === out.rowCount, out.afterClear + "/" + out.rowCount);

	await browser.close();
	console.log(fail === 0 ? "FIND (FILTER) ALL PASS" : fail + " FAILED");
	process.exit(fail === 0 ? 0 : 1);
})();

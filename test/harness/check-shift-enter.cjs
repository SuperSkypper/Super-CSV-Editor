"use strict";
// Drives Shift+Enter against the REAL grid (bundled straight from src, real
// DOM in Chromium) to prove it appends a row when the edit sits on the last
// one, and only walks down when it is anywhere else.
//
//   node test/harness/check-shift-enter.cjs
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

	// Obsidian patches HTMLElement.prototype with the DOM helpers the grid
	// uses (`empty`, `createDiv`, `addClass`, ...). A plain page lacks them.
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

		// A click on a cell is what selects it in the app; setFocus alone
		// leaves the selection null and Enter then refuses to start editing.
		const clickCell = (el, row, col) => {
			const cell = el.querySelector(`.super-csv-editor-cell[data-row="${row}"][data-col="${col}"]`)
				|| el.querySelector(".super-csv-editor-cell");
			if (!cell) throw new Error("no data cell found in the grid");
			cell.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true }));
			window.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true, cancelable: true }));
		};

		const editor = (el) => el.querySelector(".super-csv-editor-cell-editor");
		const rows = (grid) => grid.getTable().rows.length;
		// Escape is the real path a user closes an edit; cancelEdit is private.
		const esc = (el) => {
			const ta = el.querySelector(".super-csv-editor-cell-editor");
			if (ta) ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		};

		// ── 1. Editing the LAST row: append a row, keep editing it ──
		const t1 = make("TITLE,START\nalpha,1\nbeta,2\ngamma,3\n");
		const lastRow = rows(t1.grid) - 1;
		clickCell(t1.el, lastRow, 0);
		t1.grid.editFocusedCell();
		const ta1 = editor(t1.el);
		if (!ta1) throw new Error("editFocusedCell did not open an editor");
		ta1.value = "delta";
		ta1.dispatchEvent(new Event("input"));
		ta1.dispatchEvent(new KeyboardEvent("keydown", {
			key: "Enter", shiftKey: true, bubbles: true, cancelable: true,
		}));
		const last = {
			rowsBefore: lastRow + 1,
			rowsAfter: rows(t1.grid),
			keptValue: t1.grid.getTable().rows[lastRow]?.[0],
			appendedValue: t1.grid.getTable().rows[lastRow + 1]?.[0],
			editorReopened: !!editor(t1.el),
			editorRow: editor(t1.el)?.closest("[data-row]")?.dataset.row ?? null,
		};
		esc(t1.el);

		// ── 2. Mid-table: only walks down, the table must NOT grow ──
		const t2 = make("TITLE,START\nalpha,1\nbeta,2\ngamma,3\n");
		const mid = rows(t2.grid);
		clickCell(t2.el, 0, 0);
		t2.grid.editFocusedCell();
		const ta2 = editor(t2.el);
		ta2.value = "ALPHA2";
		ta2.dispatchEvent(new Event("input"));
		ta2.dispatchEvent(new KeyboardEvent("keydown", {
			key: "Enter", shiftKey: true, bubbles: true, cancelable: true,
		}));
		const middle = {
			rowsBefore: mid,
			rowsAfter: rows(t2.grid),
			committed: t2.grid.getTable().rows[0]?.[0],
			editorOpen: !!editor(t2.el),
		};
		esc(t2.el);

		// ── 3. Grid-level Shift+Enter (cell focused, NOT editing) ──
		const t3 = make("TITLE,START\nalpha,1\nbeta,2\ngamma,3\n");
		const b3 = rows(t3.grid);
		clickCell(t3.el, b3 - 1, 0);
		t3.el.dispatchEvent(new KeyboardEvent("keydown", {
			key: "Enter", shiftKey: true, bubbles: true, cancelable: true,
		}));
		const gridLast = { rowsBefore: b3, rowsAfter: rows(t3.grid) };

		const b3m = rows(t3.grid);
		clickCell(t3.el, 0, 0);
		t3.el.dispatchEvent(new KeyboardEvent("keydown", {
			key: "Enter", shiftKey: true, bubbles: true, cancelable: true,
		}));
		const gridMid = { rowsBefore: b3m, rowsAfter: rows(t3.grid) };

		// Plain Enter must still open the editor, never append a row.
		const b3p = rows(t3.grid);
		t3.el.dispatchEvent(new KeyboardEvent("keydown", {
			key: "Enter", bubbles: true, cancelable: true,
		}));
		const plain = { rowsBefore: b3p, rowsAfter: rows(t3.grid), editorOpen: !!editor(t3.el) };

		return { last, middle, gridLast, gridMid, plain };
	});

	console.log("\nShift+Enter behaviour\n");
	check("last row: a row is appended", out.last.rowsAfter === out.last.rowsBefore + 1,
		out.last.rowsBefore + " -> " + out.last.rowsAfter);
	check("last row: previous value kept", out.last.keptValue === "delta", JSON.stringify(out.last.keptValue));
	check("last row: new row is empty", out.last.appendedValue === "", JSON.stringify(out.last.appendedValue));
	check("last row: editor reopened on the new row", out.last.editorReopened === true, "row=" + out.last.editorRow);
	check("mid-table: table did NOT grow", out.middle.rowsAfter === out.middle.rowsBefore,
		out.middle.rowsBefore + " -> " + out.middle.rowsAfter);
	check("mid-table: edit committed", out.middle.committed === "ALPHA2", JSON.stringify(out.middle.committed));
	check("mid-table: editor closed", out.middle.editorOpen === false);
	check("grid-level on last row: appended", out.gridLast.rowsAfter === out.gridLast.rowsBefore + 1,
		out.gridLast.rowsBefore + " -> " + out.gridLast.rowsAfter);
	check("grid-level mid-table: did not grow", out.gridMid.rowsAfter === out.gridMid.rowsBefore,
		out.gridMid.rowsBefore + " -> " + out.gridMid.rowsAfter);
	check("plain Enter: no row added", out.plain.rowsAfter === out.plain.rowsBefore,
		out.plain.rowsBefore + " -> " + out.plain.rowsAfter);
	check("plain Enter: opens the editor", out.plain.editorOpen === true);

	await browser.close();
	console.log(fail === 0 ? "\nALL PASS" : "\n" + fail + " FAILED");
	process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.error("HARNESS ERROR", err); process.exit(1); });
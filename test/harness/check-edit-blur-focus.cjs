"use strict";
// Clicking another note while a cell is being edited must actually go there.
//
// Two things used to stop it: the blur handler claimed focus back for the grid
// (so the click's target never kept it), and the view rebuilt the links panel on
// every commit (so a backlink was torn out from under the pointer before the
// click fired). This drives the REAL GridController to pin the focus half: a
// blur that lands on something must be left alone, and only a blur that lands
// nowhere may be reclaimed.
//
//   node test/harness/check-edit-blur-focus.cjs
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

	const out = await page.evaluate(async () => {
		const { GridController } = window.__GRID__;
		const tick = () => new Promise((r) => setTimeout(r, 0));

		const el = document.createElement("div");
		document.body.appendChild(el);
		let changes = 0;
		const ref = { current: null };
		const grid = new GridController(el, window.__APP__, {
			onChange() { changes++; },
			getViewData() { return ref.current ? ref.current.getViewData() : ""; },
		});
		ref.current = grid;
		grid.loadText("A,B\n1,2\n3,4\n", ",", true, null, true);
		grid.mount();

		const dataCell = (row, col) =>
			el.querySelector('.super-csv-editor-cell[data-row="' + row + '"][data-col="' + col + '"]');
		const editorEl = () => el.querySelector(".super-csv-editor-cell-editor");

		// An outside "note" the user clicks while editing.
		const note = document.createElement("a");
		note.href = "#";
		note.textContent = "another note";
		document.body.appendChild(note);

		const openEditor = async (row, col, value) => {
			dataCell(row, col).dispatchEvent(
				new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
			);
			await tick();
			const ta = editorEl();
			if (ta && value !== undefined) {
				ta.value = value;
				ta.dispatchEvent(new Event("input", { bubbles: true }));
			}
			return ta;
		};

		// ── Clicking another note keeps focus there ──
		const editor1 = await openEditor(0, 0, "zz");
		const editorOpened = editor1 !== null && document.activeElement === editor1;
		const changesBefore = changes;

		note.focus();
		const activeAfterNote = document.activeElement === note;
		const editorClosed = editorEl() === null;
		const committed = grid.getTable().rows[0] && grid.getTable().rows[0][0] === "zz";
		const saved = changes > changesBefore;

		// The deferred reclaim must not yank focus back a tick later.
		await tick();
		await tick();
		const stillOnNote = document.activeElement === note;

		// ── A blur that lands nowhere is reclaimed (keys keep working) ──
		const editor2 = await openEditor(1, 1, "9");
		const secondOpened = editor2 !== null;
		editor2.blur();
		// Right after the blur focus is on <body>; the grid reclaims it a tick
		// later so Enter keeps reopening the editor.
		const activeWhileIdle = document.activeElement;
		await tick();
		await tick();
		const reclaimed = document.activeElement === el;

		return {
			editorOpened,
			activeAfterNote,
			editorClosed,
			committed,
			saved,
			stillOnNote,
			secondOpened,
			idleIsBody: activeWhileIdle === document.body,
			reclaimed,
		};
	});

	check("double-click opens the cell editor and focuses it", out.editorOpened);
	check("focusing another note keeps the focus there", out.activeAfterNote);
	check("the edit is committed when focus leaves", out.editorClosed);
	check("the typed value is written to the table", out.committed);
	check("the host is told to save the committed value", out.saved);
	check("the grid does not steal focus back a tick later", out.stillOnNote);
	check("a second cell can still be opened for editing", out.secondOpened);
	check("a blur with no target leaves focus on body", out.idleIsBody);
	check("the grid reclaims focus when it was left nowhere", out.reclaimed);

	await browser.close();
	console.log(fail === 0 ? "EDIT BLUR FOCUS ALL PASS" : fail + " FAILED");
	process.exit(fail === 0 ? 0 : 1);
})();

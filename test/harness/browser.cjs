"use strict";
// Shared Chromium setup for the browser harnesses: builds the harness bundle
// on demand, patches the DOM helpers Obsidian injects, and boots a page with
// the real GridController available as `window.__GRID__`.
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const { PLAYWRIGHT, CHROME } = require("./paths.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const BUNDLE = path.resolve(__dirname, "bundle-grid.js");

// Obsidian augments HTMLElement.prototype with a DOM helper library. A plain
// page has none of it, so the grid cannot render without these.
const DOM_SHIM = `
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
	HTMLElement.prototype.createDiv = function (c) { return this.createEl("div", c); };
	HTMLElement.prototype.createSpan = function (c) { return this.createEl("span", c); };
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
`;

/** Rebuilds test/harness/bundle-grid.js from src. */
function buildBundle() {
	execFileSync(process.execPath, [path.join(ROOT, "esbuild.config.mjs"), "harness"], {
		cwd: ROOT,
		stdio: "pipe",
	});
	if (!fs.existsSync(BUNDLE)) throw new Error("harness bundle was not produced");
}

/**
 * Opens a page with the grid loaded. `fn` runs in the browser and returns
 * whatever it wants; a page error is thrown rather than silently ignored.
 */
async function withGrid(fn) {
	// Always rebuild: a stale bundle silently tests yesterday's code.
	buildBundle();
	const { chromium } = require(PLAYWRIGHT);
	const browser = await chromium.launch({ executablePath: CHROME });
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	try {
		await page.addScriptTag({ path: BUNDLE });
		await page.addScriptTag({ content: DOM_SHIM + PAGE_HELPERS });
		const out = await page.evaluate(fn);
		if (errors.length) throw new Error("page errors: " + errors.join(" | "));
		return out;
	} finally {
		await browser.close();
	}
}

/** Injected into the page: helpers the checks share. */
const PAGE_HELPERS = `
	window.__mk = (text) => {
		const el = document.createElement("div");
		document.body.appendChild(el);
		const ref = { current: null };
		const grid = new window.__GRID__.GridController(el, window.__APP__, {
			onChange() {},
			getViewData() { return ref.current ? ref.current.getViewData() : ""; },
		});
		ref.current = grid;
		grid.loadText(text, ",", true, null, true);
		grid.mount();
		return { grid, el };
	};
	window.__cell = (el, row, col) =>
		el.querySelector('.super-csv-editor-cell[data-row="' + row + '"][data-col="' + col + '"]');
	window.__gutter = (el, row) =>
		el.querySelector('tr[data-row="' + row + '"] .super-csv-editor-gutter, tr[data-row="' + row + '"] .is-gutter-cell');
	window.__editor = (el) => el.querySelector(".super-csv-editor-cell-editor");
	window.__click = (target, init) => {
		target.dispatchEvent(new MouseEvent("mousedown", Object.assign({ button: 0, bubbles: true, cancelable: true }, init)));
		window.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true, cancelable: true }));
	};
	window.__key = (target, init) =>
		target.dispatchEvent(new KeyboardEvent("keydown", Object.assign({ bubbles: true, cancelable: true }, init)));
	window.__esc = (el) => { const t = window.__editor(el); if (t) window.__key(t, { key: "Escape" }); };
`;

module.exports = { withGrid, PAGE_HELPERS, DOM_SHIM, buildBundle, PLAYWRIGHT, CHROME, BUNDLE };
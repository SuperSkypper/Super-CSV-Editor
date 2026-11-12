"use strict";
// Isolates the report precisely: after a horizontal scroll, which COLUMN's
// values leak? The user says column 1 only.
//
// The gutter is index -1 (no data-col); data column 0 is `data-col="0"`, which
// the user may well be calling "column 1". This probe labels cells both ways so
// the answer is unambiguous.
const path = require("node:path");
const fs = require("node:fs");
const Module = require("node:module");
const mock = require("./obsidian-mock.cjs");
const oR = Module._resolveFilename, oL = Module._load;
Module._resolveFilename = function (r, ...a) { return r === "obsidian" ? "obsidian" : oR.call(this, r, ...a); };
Module._load = function (r, ...a) { return r === "obsidian" ? mock : oL.call(this, r, ...a); };

const { PLAYWRIGHT, CHROME } = require("./paths.cjs");

let csvText = "";
const file = new mock.TFile("logs.csv");
const app = {
  vault: { async read() { return csvText; }, async modify() {}, on() { return {}; } },
  metadataCache: { getFirstLinkpathDest: () => null, on() { return {}; } },
  workspace: { getLeavesOfType: () => [], openLinkText() {}, on() { return {}; } },
  fileManager: { generateMarkdownLink: () => "" },
  embedRegistry: { _map: new Map(), isExtensionRegistered(e) { return this._map.has(e); }, registerExtension(e, f) { this._map.set(e, f); }, unregisterExtension(e) { this._map.delete(e); } },
};
globalThis.__APP__ = app;
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  createElement: (t) => new mock.FakeEl(t),
  createRange: () => ({ selectNodeContents() {}, getBoundingClientRect() { return { width: 10 }; }, detach() {} }),
  activeElement: null, body: new mock.FakeEl("body"),
};
globalThis.window = {
  getComputedStyle: () => ({ paddingLeft: "4px", paddingRight: "4px", borderLeftWidth: "1px", borderRightWidth: "1px" }),
  setTimeout: (f, m) => setTimeout(f, m), clearTimeout: (t) => clearTimeout(t),
  addEventListener() {}, removeEventListener() {},
};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const bp = path.resolve(__dirname, "bundle.cjs");
fs.writeFileSync(bp, fs.readFileSync(path.resolve(__dirname, "..", "..", "main.js")));
const P = require(bp).default ?? require(bp);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function serialize(el) {
  const cls = [...(el.classList?._values ?? [])].join(" ");
  const attrs = Object.entries(el.attrs ?? {}).filter(([k]) => k !== "class").map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  const st = el.style && Object.keys(el.style).length ? ` style="${Object.entries(el.style).map(([k, v]) => `${k}:${v}`).join(";")}"` : "";
  return `<${el.tagName} class="${cls}"${attrs}${st}>${el._text ? esc(el._text) : ""}${(el.children ?? []).map(serialize).join("")}</${el.tagName}>`;
}

const REAL_CSS = fs.readFileSync(path.resolve(__dirname, "..", "..", "styles.css"), "utf8");
const pageHtml = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin:0; height:100%; background:#1e1e1e; }
:root { --text-faint:#888; --text-muted:#aaa; --text-normal:#ddd; --background-primary:#1e1e1e;
  --background-secondary:#262626; --background-modifier-border:#3a3a3a; --background-modifier-hover:#333;
  --font-monospace:monospace; --font-interface:sans-serif; --font-ui-smaller:11px; --font-ui-small:13px;
  --font-semibold:600; --radius-s:4px; --shadow-s:0 1px 2px rgba(0,0,0,.3); --interactive-accent:#7c6bd6;
  --link-color:#7c9cf5; --link-unresolved-color:#9a9a9a; --link-unresolved-decoration-color:#666; }
${REAL_CSS}
.note { width: 500px; padding: 16px; box-sizing: border-box; }
</style></head><body>${body}</body></html>`;

// The screenshot's own data, plus width so it must scroll.
csvText =
  "TITLE,START,YEAR\nSession 1,2025/01/15 10:30:00,2025\nSession 2,2025/02/20 14:45:00,2025\n";

(async () => {
  const inst = new P(app, { id: "super-csv-editor", name: "Super CSV Editor" });
  await inst.onload();
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch({ executablePath: CHROME });

  const container = new mock.FakeEl("div");
  const child = app.embedRegistry._map.get("csv")({ app, containerEl: container }, file, "");
  await child.loadFile();

  const page = await browser.newPage({ viewport: { width: 560, height: 220 } });
  await page.setContent(pageHtml(`<div class="note">${serialize(container)}</div>`));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  for (const offset of [0, 60, 120]) {
    const r = await page.evaluate(async (left) => {
      const scroll = document.querySelector(".super-csv-editor-scroll");
      scroll.scrollLeft = left;
      await new Promise((res) => requestAnimationFrame(res));
      const leaks = [];
      document.querySelectorAll(".super-csv-editor-cell").forEach((c) => {
        const text = (c.textContent ?? "").trim();
        if (!text) return;
        const box = c.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(c);
        const t = range.getBoundingClientRect();
        const over = Math.round(t.right - box.right);
        if (over > 0) {
          const dc = c.dataset.col;
          leaks.push({
            // Human label: gutter is "col 0" visually, data-col 0 is "col 1".
            humanCol: dc === undefined ? "gutter (col 0)" : `data-col ${dc} (col ${Number(dc) + 1})`,
            dc: dc ?? "gutter",
            text, over,
            w: Math.round(box.width),
            textW: Math.round(t.width),
          });
        }
      });
      return leaks;
    }, offset);

    console.log(`\n=== scrollLeft = ${offset} ===`);
    if (r.length === 0) console.log("  no leaks");
    // Group by which visual column leaks.
    const byCol = {};
    r.forEach((x) => { byCol[x.humanCol] = (byCol[x.humanCol] ?? 0) + 1; });
    Object.entries(byCol).forEach(([k, v]) => console.log(`  ${k}: ${v} leaking cells`));
    r.slice(0, 4).forEach((x) => console.log(`    ${x.humanCol} "${x.text}" text=${x.textW}px in band=${x.w}px, over ${x.over}px`));
  }

  await browser.close();
  fs.unlinkSync(bp);
})();

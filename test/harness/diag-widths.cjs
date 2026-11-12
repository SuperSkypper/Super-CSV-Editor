"use strict";
// Proves the diagnosis in a REAL browser with the REAL bundle + stylesheet:
// a data column can be sized narrower than the text its own cells render, so
// the glyphs overflow the band and the neighbouring vertical border is drawn
// straight through them. That is the "second row crossing the column" report.
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
  createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 10 }), detach() {} }),
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
.note { width: 700px; padding: 16px; box-sizing: border-box; }
</style></head><body>${body}</body></html>`;

csvText = "TITLE,START\nSession 1,2018/06/14 17:35:00\nSession 2,2018/06/14 19:45:00\n";

(async () => {
  const inst = new P(app, { id: "super-csv-editor", name: "Super CSV Editor" });
  await inst.onload();
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch({ executablePath: CHROME });

  const container = new mock.FakeEl("div");
  const child = app.embedRegistry._map.get("csv")({ app, containerEl: container }, file, "");
  await child.loadFile();

  const page = await browser.newPage({ viewport: { width: 760, height: 240 } });
  await page.setContent(pageHtml(`<div class="note">${serialize(container)}</div>`));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const r = await page.evaluate(() => {
    const widths = [...document.querySelectorAll("colgroup col")].map((c) => Math.round(c.getBoundingClientRect().width));
    const rows = [...document.querySelectorAll("tbody .super-csv-editor-row")];
    const cells = rows.map((row) =>
      [...row.querySelectorAll(".super-csv-editor-cell")].map((c) => {
        const box = c.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(c);
        const t = range.getBoundingClientRect();
        return {
          col: c.dataset.col ?? "gutter",
          text: c.textContent,
          cellW: Math.round(box.width),
          textW: Math.round(t.width),
          overflowRight: Math.round(t.right - box.right),
        };
      }),
    );
    return { widths, cells };
  });

  console.log(`colgroup widths (gutter, TITLE, START, ghost): ${r.widths.join(", ")}`);
  let bad = 0;
  r.cells.forEach((row, i) => {
    console.log(`\n--- data row ${i + 1} ---`);
    row.forEach((c) => {
      const overflows = c.overflowRight > 0;
      if (overflows) bad++;
      console.log(`  ${c.col.padEnd(6)} "${c.text}"  cell=${c.cellW}px text=${c.textW}px overflowRight=${c.overflowRight}px ${overflows ? "<-- OVERFLOWS" : ""}`);
    });
  });
  console.log(`\ncells whose text overflows their column: ${bad}`);

  await page.screenshot({ path: path.join(require("node:os").tmpdir(), "diag2.png") });
  await browser.close();
  fs.unlinkSync(bp);
})();

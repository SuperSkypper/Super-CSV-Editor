"use strict";
// The report: scrolling horizontally, only COLUMN 1's values leak out.
//
// Column 1 is the row-number gutter: `position: sticky; left: 0`. A sticky cell
// is a stacking/clip boundary in its own right, and `overflow: hidden` on it
// does NOT clip reliably while the table scrolls — the cell's own text keeps
// painting past its band because the sticky box is repositioned every frame.
// Every other column is a normal cell and clips fine.
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
const check = (n, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${n}`); return ok; };

const REAL_CSS = fs.readFileSync(path.resolve(__dirname, "..", "..", "styles.css"), "utf8");
const pageHtml = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin:0; height:100%; background:#1e1e1e; }
:root { --text-faint:#888; --text-muted:#aaa; --text-normal:#ddd; --background-primary:#1e1e1e;
  --background-secondary:#262626; --background-modifier-border:#3a3a3a; --background-modifier-hover:#333;
  --font-monospace:monospace; --font-interface:sans-serif; --font-ui-smaller:11px; --font-ui-small:13px;
  --font-semibold:600; --radius-s:4px; --shadow-s:0 1px 2px rgba(0,0,0,.3); --interactive-accent:#7c6bd6;
  --link-color:#7c9cf5; --link-unresolved-color:#9a9a9a; --link-unresolved-decoration-color:#666; }
${REAL_CSS}
.note { width: 460px; padding: 16px; box-sizing: border-box; }
</style></head><body>${body}</body></html>`;

// Narrow note + wide columns so the grid MUST scroll horizontally.
csvText =
  Array.from({ length: 6 }, (_, i) => `COLUMN_${i}_WIDE`).join(",") + "\n" +
  Array.from({ length: 5 }, () => Array.from({ length: 6 }, (_, i) => `value_${i}_xxxxxxxx`).join(",")).join("\n");

(async () => {
  const inst = new P(app, { id: "super-csv-editor", name: "Super CSV Editor" });
  await inst.onload();
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch({ executablePath: CHROME });
  const results = [];

  const container = new mock.FakeEl("div");
  const child = app.embedRegistry._map.get("csv")({ app, containerEl: container }, file, "");
  await child.loadFile();

  const page = await browser.newPage({ viewport: { width: 520, height: 300 } });
  await page.setContent(pageHtml(`<div class="note">${serialize(container)}</div>`));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  for (const offset of [0, 120, 240]) {
    const r = await page.evaluate(async (left) => {
      const scroll = document.querySelector(".super-csv-editor-scroll");
      scroll.scrollLeft = left;
      await new Promise((res) => requestAnimationFrame(res));

      const bad = [];
      // Every cell: does its TEXT paint past its band?
      document.querySelectorAll(".super-csv-editor-cell").forEach((c) => {
        const box = c.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(c);
        const t = range.getBoundingClientRect();
        const over = Math.round(t.right - box.right);
        if (over > 0 && (c.textContent ?? "").trim() !== "") {
          bad.push({
            kind: c.classList.contains("is-gutter-cell") ? "GUTTER" : "data",
            col: c.dataset.col ?? "gutter",
            text: c.textContent,
            over,
            sticky: getComputedStyle(c).position,
          });
        }
      });
      return bad;
    }, offset);

    console.log(`\n=== scrollLeft = ${offset} ===`);
    const gutters = r.filter((b) => b.kind === "GUTTER");
    const data = r.filter((b) => b.kind === "data");
    console.log(`  gutter cells whose text leaks: ${gutters.length}`);
    gutters.slice(0, 3).forEach((b) => console.log(`    "${b.text}" overflows ${b.over}px (position=${b.sticky})`));
    console.log(`  data cells whose text leaks:  ${data.length}`);
    data.slice(0, 3).forEach((b) => console.log(`    col${b.col} "${b.text}" overflows ${b.over}px`));

    results.push(check(`at scrollLeft ${offset}, ONLY the gutter leaks (if any)`, data.length === 0));
  }

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await page.screenshot({ path: path.join(require("node:os").tmpdir(), "gutter-leak.png") });
  await browser.close();
  fs.unlinkSync(bp);
  process.exit(results.every(Boolean) ? 0 : 1);
})();

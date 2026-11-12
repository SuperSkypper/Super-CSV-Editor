"use strict";
// Proves the multi-row delete path end to end in a real browser: selecting
// several rows (gutter click, Ctrl+click, Shift+click) and deleting them in one
// action must remove exactly those rows.
//
//   node test/harness/check-multi-delete.cjs
const { withGrid } = require("./browser.cjs");

let fail = 0;
const check = (name, ok, detail) => {
	console.log((ok ? "  ok   " : "  FAIL ") + name + (detail === undefined ? "" : "  -> " + detail));
	if (!ok) fail++;
};

(async () => {
	const out = await withGrid(() => {
		const titles = (grid) => grid.getTable().rows.map((r) => r[0]);
		const res = {};

		// ── 1. Ctrl+click two gutter numbers, then delete rows ──
		{
			const { grid, el } = window.__mk("TITLE,START\na,1\nb,2\nc,3\nd,4\ne,5\n");
			window.__click(window.__gutter(el, 1));
			window.__click(window.__gutter(el, 3), { ctrlKey: true });
			grid.removeRow();
			res.ctrlAfter = titles(grid);
			res.ctrlCount = grid.getTable().rows.length;
		}

		// ── 2. Shift+click a gutter number extends the range ──
		{
			const { grid, el } = window.__mk("TITLE,START\na,1\nb,2\nc,3\nd,4\ne,5\n");
			window.__click(window.__gutter(el, 1));
			window.__click(window.__gutter(el, 3), { shiftKey: true });
			grid.removeRow();
			res.shiftAfter = titles(grid);
		}

		// ── 3. Selecting a whole row by dragging cells, then delete ──
		{
			const { grid, el } = window.__mk("TITLE,START\na,1\nb,2\nc,3\nd,4\ne,5\n");
			const c0 = window.__cell(el, 1, 0);
			window.__click(c0);
			window.__key(el, { key: "a", ctrlKey: true });
			// Ctrl+A selects everything; delete rows should then clear the sheet.
			grid.removeRow();
			res.ctrlAAfter = titles(grid);
		}

		// ── 4. Column selection + removeColumn ──
		{
			const { grid, el } = window.__mk("TITLE,START,NOTE\na,1,x\nb,2,y\nc,3,z\n");
			// The header listens on mouseup (so a drag does not select), so the
			// harness has to press and release like a real click.
			const tap = (th, init) => {
				th.dispatchEvent(new MouseEvent("mousedown", Object.assign({ button: 0, bubbles: true, cancelable: true }, init)));
				th.dispatchEvent(new MouseEvent("mouseup", Object.assign({ button: 0, bubbles: true, cancelable: true }, init)));
			};
			tap(el.querySelector('th[data-col="0"]'));
			tap(el.querySelector('th[data-col="1"]'), { ctrlKey: true });
			grid.removeColumn();
			res.colsAfter = grid.getTable().rows.map((r) => r.join("|"));
		}

		// ── 5. Nothing selected: Delete must not throw or nuke the sheet ──
		{
			const { grid } = window.__mk("TITLE,START\na,1\nb,2\n");
			grid.deselect();
			let threw = null;
			try { grid.removeRow(); } catch (e) { threw = String(e && e.message); }
			res.noSelThrew = threw;
			res.noSelAfter = titles(grid);
		}

		return res;
	});

	console.log("\nMulti-row / multi-column delete\n");
	check("ctrl-click rows then delete keeps 3", out.ctrlCount === 3, out.ctrlAfter.join(","));
	check("ctrl-click deleted exactly b and d",
		out.ctrlAfter.join(",") === "a,c,e", out.ctrlAfter.join(","));
	check("shift-click range deletes b,c,d", out.shiftAfter.join(",") === "a,e", out.shiftAfter.join(","));
	check("ctrl+A then delete empties the sheet", out.ctrlAAfter.length === 0, JSON.stringify(out.ctrlAAfter));
	check("two columns deleted leaves the third",
		out.colsAfter.every((r) => r === "x" || r === "y" || r === "z"), JSON.stringify(out.colsAfter));
	check("delete with no selection does not throw", out.noSelThrew === null, String(out.noSelThrew));
	check("delete with no selection is a no-op", out.noSelAfter.join(",") === "a,b", out.noSelAfter.join(","));

	console.log(fail === 0 ? "\nALL PASS" : "\n" + fail + " FAILED");
	process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.error("HARNESS ERROR", err); process.exit(1); });
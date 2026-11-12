"use strict";
// Regression check for the embed's gesture guards.
//
// The embed cancels every mousedown so Obsidian's hover-preview popover does
// not open over the table. That cancellation also reached the cell editor's
// <textarea>: a mousedown with preventDefault does not place the caret, so
// clicking in the middle of a value put the cursor at the start of it and
// typing overwrote the wrong end of the text.
//
// This drives the real `guardEmbedMouse` / `guardEmbedSelectStart` from
// src/ui/embed.ts — a copied handler would pass even if the shipped one were
// broken again.
const { withGrid } = require("./browser.cjs");

withGrid(() => {
	const results = [];
	const check = (name, ok) => results.push({ name, ok });

	// Exactly how embed.ts wires them up.
	const container = document.createElement("div");
	document.body.appendChild(container);
	container.addEventListener("mousedown", window.__GRID__.guardEmbedMouse);
	container.addEventListener("selectstart", window.__GRID__.guardEmbedSelectStart);

	const { grid, el } = window.__mk("Name,Note\nalpha,hello\n");
	container.appendChild(el);

	const cell = window.__cell(el, 0, 0);
	check("cell exists in the DOM", !!cell);
	if (!cell) return { results };
	// The editor opens on a double click, which is how the grid is built: a
	// single click only moves the selection.
	cell.dispatchEvent(new MouseEvent("dblclick", { button: 0, bubbles: true, cancelable: true }));
	const editor = window.__editor(el);
	check("editor opens on double click", !!editor);
	if (!editor) return { results };

	// dispatchEvent returns false when a handler called preventDefault, which
	// is the property that decides whether the browser places the caret.
	//
	// Order matters: a mousedown on the cell re-renders the grid and closes
	// the editor, so it must come after the editor checks or they would fire at
	// a detached node and never reach the guard at all.
	const fired = (target, type) =>
		target.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, cancelable: true }));

	check("mousedown on the editor is NOT cancelled (caret must follow the click)", fired(editor, "mousedown"));
	check("selectstart on the editor is NOT cancelled (user can select text)", fired(editor, "selectstart"));


	check("mousedown on the cell is cancelled (hover-preview guard intact)", !fired(cell, "mousedown"));
	check("selectstart on the cell is cancelled (drag cannot escape the embed)", !fired(cell, "selectstart"));

	grid.dispose();
	return { results };
}).then(({ results }) => {
	let failed = 0;
	for (const { name, ok } of results) {
		if (!ok) failed++;
		console.log((ok ? "  ok   " : "  FAIL ") + name);
	}
	console.log(failed === 0 ? "EMBED GESTURE GUARDS ALL PASS" : failed + " FAILED");
	process.exit(failed === 0 ? 0 : 1);
});
"use strict";
// Regression check for the keyboard lock swallowing keystrokes aimed at a
// text field outside the grid.
//
// The grid installs a capture-phase document keydown listener so Obsidian's
// global shortcuts do not fire while a cell is selected. When the rename-column
// dialog opened, clicking the header had just selected that column, so the
// lock consumed every character typed into the dialog's input and the field
// was uneditable. The lock must still fire for keys that belong to the grid.
const { withGrid } = require("./browser.cjs");

withGrid(() => {
	const results = [];
	const check = (name, ok) => results.push({ name, ok });

	const { grid } = window.__mk("Name,Note\nalpha,hello\n");
	const press = (target, key) =>
		target.dispatchEvent(
			new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
		);

	// A key with nothing selected passes through the lock.
	check("key with no selection is not swallowed", press(document.body, "a") === true);

	// Select a column, the way clicking its header does before the dialog opens.
	grid.selectColumn(0, false);
	check("column selection is active", grid.selection !== null);

	// The dialog's text field lives in an Obsidian modal, outside the grid.
	const modal = document.createElement("div");
	modal.className = "modal-container";
	const input = document.createElement("input");
	modal.appendChild(input);
	document.body.appendChild(modal);
	input.focus();

	check(
		"typing in the rename-column dialog is NOT swallowed",
		press(input, "a") === true,
	);
	check("Escape in the dialog is NOT swallowed", press(input, "Escape") === true);

	// The lock still guards grid-focused shortcuts: a key that lands on the
	// document while the grid has a selection must be consumed.
	check(
		"a stray key with the grid selected IS still swallowed",
		press(document.body, "a") === false,
	);

	grid.dispose();
	return { results };
}).then(({ results }) => {
	let failed = 0;
	for (const { name, ok } of results) {
		if (!ok) failed++;
		console.log((ok ? "  ok   " : "  FAIL ") + name);
	}
	console.log(failed === 0 ? "KEYBOARD LOCK GUARDS ALL PASS" : failed + " FAILED");
	process.exit(failed === 0 ? 0 : 1);
});

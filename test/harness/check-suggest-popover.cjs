"use strict";
// Checks the `[[` popover behaves like Obsidian's own suggestion list.
//
// The native popover is a `.suggestion-container` of `.suggestion-item`s with
// `.is-selected` on the highlighted one, and hovering a row selects it. The
// plugin cannot reuse that component (a <textarea> cannot host an
// EditorSuggest), so it rebuilds the same behaviour on a positioned div — these
// checks drive the SHIPPED LinkSuggestPopover class, so a drift in the real
// code fails here rather than in the user's hands.
const { withGrid } = require("./browser.cjs");

withGrid(() => {
	const results = [];
	const check = (name, ok) => results.push({ name, ok });

	// A vault with two notes, one of which shares its basename with another
	// path so the "show the path" branch is exercised.
	// Two Supermans (a colliding basename, which must show its path) plus a
	// unique name, which must ALSO show its path — a list where only the
	// ambiguous rows carry one reads as if the others have no location.
	const files = [
		{ path: "Notes/Superman.md", basename: "Superman" },
		{ path: "Archive/Superman.md", basename: "Superman" },
		{ path: "Archive/Batman.md", basename: "Batman" },
	];
	const app = { vault: { getFiles: () => files } };
	let accepted = null;

	const popover = new window.__GRID__.LinkSuggestPopover(app, (value) => {
		accepted = value;
	});

	const textarea = document.createElement("textarea");
	textarea.value = "See [[";
	textarea.selectionStart = textarea.value.length;
	document.body.appendChild(textarea);

	const opened = popover.update(textarea);
	check("typing [[ opens the popover", opened);
	check("the popover is in the DOM", !!document.querySelector(".super-csv-editor-suggest"));

	const rows = document.querySelectorAll(".super-csv-editor-suggest-item");
	check("every note in the vault is offered", rows.length === 3, "rows=" + rows.length);

	// The colliding basename must show its path, which is the whole reason to
	// keep the path line: without it the two entries are indistinguishable.
	check(
		"a colliding basename shows its path",
		rows[0].querySelector(".super-csv-editor-suggest-path")?.textContent === "Notes/Superman.md",
	);
	check(
		"each row shows the title above the path",
		rows[0].querySelector(".super-csv-editor-suggest-name")?.textContent === "Superman",
	);

	// A uniquely named note still shows its path: the native popover does, and
	// hiding it only for unambiguous names makes the rows look inconsistent.
	const batman = [...rows].find(
		(r) => r.querySelector(".super-csv-editor-suggest-name")?.textContent === "Batman",
	);
	check(
		"a uniquely named note also shows its path",
		batman?.querySelector(".super-csv-editor-suggest-path")?.textContent === "Archive/Batman.md",
	);

	check("exactly one row is highlighted", document.querySelectorAll(".is-active").length === 1);

	// Hover the second row: the highlight follows the pointer, the way the
	// native list does, so Enter accepts what the user is pointing at.
	rows[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
	check("hovering a row selects it", rows[1].hasClass("is-active"));
	check("hovering releases the previous row", !rows[0].hasClass("is-active"));

	// Arrow keys wrap at the ends, like the native list. Start at the bottom:
	// the row is 1, the list has 3 entries, so one move down must come back to 0.
	popover.move(1);
	check("arrow down from the second row moves to the third", rows[2].hasClass("is-active"));
	popover.move(1);
	check("arrow down wraps past the last row to the first", rows[0].hasClass("is-active"));
	popover.move(-1);
	check("arrow up wraps past the first row to the last", rows[2].hasClass("is-active"));

	// Accepting inserts the link with the path, because two files share the
	// name. Row 1 is Archive/Superman, and the arrows above left the selection
	// elsewhere, so point at it the way a user would: hover.
	rows[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
	check("hovering re-selects the intended row", rows[1].hasClass("is-active"));
	popover.accept(textarea);
	check("accepting closes the popover", !popover.isOpen);
	check(
		"accepting inserts the disambiguated link",
		accepted === "See [[Archive/Superman]]",
		"accepted=" + JSON.stringify(accepted),
	);

	popover.close();
	return { results };
}).then(({ results }) => {
	let failed = 0;
	for (const { name, ok } of results) {
		if (!ok) failed++;
		console.log((ok ? "  ok   " : "  FAIL ") + name);
	}
	console.log(failed === 0 ? "SUGGEST POPOVER ALL PASS" : failed + " FAILED");
	process.exit(failed === 0 ? 0 : 1);
});
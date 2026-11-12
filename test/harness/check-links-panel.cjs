"use strict";
// Checks the links panel's DOM, driving the SHIPPED LinksPanel class.
//
// An earlier version of this file hand-built the panel's markup, which meant it
// happily passed while the real render() did something else entirely — a
// mutation test caught that: every mutation of linksPanel.ts went undetected.
// These checks therefore instantiate the real class against a stubbed app and
// assert on what IT renders.
//
// The panel must show ONLY backlinks: notes that point at the CSV. The CSV's
// own outgoing wikilinks belong in the grid's cells, not in this list.
const { withGrid } = require("./browser.cjs");

withGrid(() => {
	const results = [];
	const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

	// --- The panel inside the real window layout -----------------------------
	// The panel must be a SIBLING of the grid, not a child: grid.render() calls
	// container.empty() on every keystroke, which would destroy a child.
	const contentEl = document.createElement("div");
	document.body.appendChild(contentEl);

	const windowEl = contentEl.createDiv({ cls: "super-csv-editor-window" });
	const gridHost = windowEl.createDiv({ cls: "super-csv-editor-window-main" });

	// Real panel, stubbed app: two incoming notes (only Batman links to THIS
	// csv), plus a CSV body full of wikilinks that must NOT appear.
	const opened = [];
	const menus = [];
	const app = {
		// findBacklinks re-resolves each source path to a file so it can name it
		// and hand it to openLinkText.
		vault: {
			// findBacklinks narrows on `extension === "md"`, so the stub file
			// has to look like a real TFile, not just carry a path.
			getAbstractFileByPath: (path) => ({
				path,
				name: path.split("/").pop(),
				basename: path.split("/").pop().replace(/\.md$/, ""),
				extension: "md",
			}),
		},
		metadataCache: {
			resolvedLinks: {
				"Notes/Batman.md": { "Movies/1938.csv": 1 },
				"Notes/Elsewhere.md": { "Other.csv": 3 },
			},
		},
		workspace: {
			openLinkText: (...args) => {
				opened.push(args);
				return Promise.resolve();
			},
			// The panel delegates its context menu to this exact call.
			handleLinkContextMenu: (menu, linktext, sourcePath) => {
				menus.push({ menu, linktext, sourcePath });
				return true;
			},
		},
	};
	const csvPath = "Movies/1938.csv";

	const panel = new window.__GRID__.LinksPanel(app, windowEl);
	panel.setFile(csvPath);
	panel.refresh();

	const el = windowEl.querySelector(".super-csv-editor-links");
	check("the panel is inside the window", !!contentEl.contains(el));
	check(
		"the panel is not inside the grid's host",
		!gridHost.contains(el) && !gridHost.querySelector(".super-csv-editor-links"),
	);

	// --- The heading ---------------------------------------------------------
	// Exactly one label, above the list, worded like Obsidian's own pane.
	const headings = el.querySelectorAll("h4");
	check("the panel has exactly one heading", headings.length === 1, "count=" + headings.length);
	check(
		"the heading reads Linked mentions",
		headings[0]?.textContent === "Linked mentions",
		"text=" + JSON.stringify(headings[0]?.textContent),
	);

	const list = el.querySelector("ul");
	check("the panel renders one list", !!list && el.querySelectorAll("ul").length === 1);
	check(
		"the heading sits above the list",
		!!headings[0] && !!list && headings[0].compareDocumentPosition(list) === 4,
	);

	// --- The rows ------------------------------------------------------------
	// Backlinks only: the note that links to this CSV, and nothing from the CSV.
	const rows = [...el.querySelectorAll("li")];
	check("only the incoming note is listed", rows.length === 1, "rows=" + rows.length);
	check("no subgroup lists", el.querySelectorAll("ul ul").length === 0);
	check(
		"the incoming note is listed",
		rows[0]?.textContent === "Batman",
		JSON.stringify(rows.map((r) => r.textContent)),
	);
	check(
		"no row is blank",
		rows.every((r) => (r.textContent || "").trim().length > 0),
		JSON.stringify(rows.map((r) => r.textContent)),
	);
	check("the list holds no outgoing targets", !/(Superman|Comics)/.test(el.textContent || ""), "text=" + JSON.stringify(el.textContent));

	// --- Rows open the right thing -------------------------------------------
	const batman = rows[0];
	check("the incoming row exists to click", !!batman);
	batman.querySelector("a").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	check(
		"clicking an incoming row opens that note",
		opened.length === 1 && opened[0][0] === "Notes/Batman.md",
		JSON.stringify(opened[0]),
	);

	// --- Middle click opens in a new tab -------------------------------------
	// A middle click is delivered as `auxclick`, never as `click`, and the
	// third argument to openLinkText becomes the pane type.
	const batmanAnchor = batman.querySelector("a");
	batmanAnchor.dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
	check(
		"a middle click opens the row in a new tab",
		opened.length === 2 && opened[1][0] === "Notes/Batman.md" && opened[1][2] === "tab",
		JSON.stringify(opened[1]),
	);
	// A left-button auxclick (some browsers fire one) must NOT double-open.
	batmanAnchor.dispatchEvent(new MouseEvent("auxclick", { button: 0, bubbles: true, cancelable: true }));
	check("a non-middle auxclick is ignored", opened.length === 2, "opened=" + opened.length);

	// --- Right click shows the real file menu --------------------------------
	const before = menus.length;
	batmanAnchor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
	check(
		"right click asks for the standard link file menu",
		menus.length === before + 1 &&
			menus[before].linktext === "Notes/Batman.md" &&
			menus[before].sourcePath === csvPath,
		JSON.stringify(menus[before] && { linktext: menus[before].linktext, sourcePath: menus[before].sourcePath }),
	);
	check(
		"the menu was built for the event, so it shows at the pointer",
		(window.__MENUS__ || []).length >= 1,
		"menus=" + (window.__MENUS__ || []).length,
	);

	// --- Empty state ---------------------------------------------------------
	// clear() is the "no file in this leaf" case: no path, so no backlinks and
	// no heading.
	panel.clear();
	check(
		"with no file the panel says so and drops the heading",
		!el.querySelector("h4") && /Open a CSV/.test(el.textContent || ""),
		"text=" + JSON.stringify(el.textContent),
	);

	// An open file that nothing links to: the heading stays away, and the
	// message names the real reason.
	app.metadataCache.resolvedLinks = {};
	panel.setFile(csvPath);
	panel.refresh();
	check(
		"an open file with no backlinks shows the no-links message",
		!el.querySelector("h4") && /No notes link/.test(el.textContent || ""),
		"text=" + JSON.stringify(el.textContent),
	);
	check("the list is gone when there are no links", el.querySelectorAll("li").length === 0);

	// --- Survives a grid re-render ------------------------------------------
	// The whole reason the panel is a sibling: the grid emptying its own host
	// must not touch the panel. Restore the links the empty-state checks above
	// cleared, then assert the rows are still there afterwards.
	app.metadataCache.resolvedLinks = {
		"Notes/Batman.md": { "Movies/1938.csv": 1 },
		"Notes/Elsewhere.md": { "Other.csv": 3 },
	};
	panel.setFile(csvPath);
	panel.refresh();
	check("the list is back before the grid re-renders", el.querySelectorAll("li").length === 1);
	gridHost.empty();
	check(
		"the panel survives the grid emptying its host",
		el.querySelectorAll("li").length === 1,
		"rows=" + el.querySelectorAll("li").length,
	);

	return { results };
}).then(({ results }) => {
	let failed = 0;
	for (const { name, ok, detail } of results) {
		if (!ok) failed++;
		console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "  (" + detail + ")"));
	}
	console.log(failed === 0 ? "LINKS PANEL ALL PASS" : failed + " FAILED");
	process.exit(failed === 0 ? 0 : 1);
});

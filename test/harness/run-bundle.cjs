"use strict";
// Loads the built bundle with a mocked `obsidian` module and runs the real
// plugin lifecycle, so an onload-time crash or a missing registration is
// reproducible outside the app.
const path = require("node:path");
const Module = require("node:module");

const mock = require("./obsidian-mock.cjs");

const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._resolveFilename = function (request, ...rest) {
	if (request === "obsidian") return "obsidian";
	return originalResolve.call(this, request, ...rest);
};
Module._load = function (request, ...rest) {
	if (request === "obsidian") return mock;
	return originalLoad.call(this, request, ...rest);
};

const csvPath = process.argv[2] ?? "logs.csv";
// Shell-escaped newlines in argv stay literal, so they are expanded here.
const csvText = (process.argv[3] ?? "A,B\n1,2\n3,4\n5,6\n7,8\n9,10\n").replace(/\\n/g, "\n");
const file = new mock.TFile(csvPath);

const app = {
	vault: {
		async read(f) {
			if (f.path === csvPath) return csvText;
			throw new Error("not found: " + f.path);
		},
		async modify(f, data) {
			app.__writes.push({ path: f.path, data });
		},
		on() { return {}; },
	},
	metadataCache: {
		getFirstLinkpathDest(linkpath) {
			return linkpath.endsWith(".csv") ? file : null;
		},
		on() { return {}; },
	},
	workspace: {
		activeLeaf: null,
		getMostRecentLeaf() { return app.workspace.__recentLeaf ?? null; },
		getLeavesOfType() { return []; },
		openLinkText(...args) { app.__opens.push(args); return Promise.resolve(); },
		revealLeaf() {},
		getRightLeaf() { return { openFile: () => Promise.resolve() }; },
		getLeaf() { return { openFile: () => Promise.resolve() }; },
		on() { return {}; },
		// The plugin contributes the core `file-menu` items through this call,
		// so the harness records it to prove the CSV's menu triggers it.
		trigger(name, ...args) { app.__menus.push({ name, args }); },
		handleLinkContextMenu() {},
		// Mirrors Obsidian's own recents filter: a `.csv` is a non-image
		// attachment, so it is only returned when the caller asks for it.
		getRecentFiles(options) {
			const opts = Object.assign(
				{ showMarkdown: true, showNonAttachments: true, showNonImageAttachments: false, showImages: false, maxCount: 10 },
				options,
			);
			return ["notes/latest.md", "data/report.csv", "notes/older.md"]
				.filter((p) => {
					const ext = p.split(".").pop();
					if (ext === "md") return opts.showMarkdown;
					if (ext === "csv") return opts.showNonImageAttachments;
					return false;
				})
				.slice(0, opts.maxCount);
		},
	},
	fileManager: {
		generateMarkdownLink: () => "",
		// Mirrors the real rename: the TFile is mutated in place, which is what
		// lets the view keep its grid after the file moves.
		async renameFile(file, newPath) {
			app.__renames.push({ from: file.path, to: newPath });
			file.path = newPath;
			file.name = newPath.split("/").pop();
			file.extension = file.name.split(".").pop();
			file.basename = file.name.slice(0, file.name.length - file.extension.length - 1);
		},
		promptForFileRename(file) { app.__promptRename.push(file.path); },
		promptForDeletion(file) { app.__promptDelete.push(file.path); },
	},
	plugins: {
		async disablePlugin(id) { app.__events.push("disable:" + id); },
		async enablePlugin(id) { app.__events.push("enable:" + id); },
	},
	// The view's Ctrl+F scope parents onto the app scope, and is pushed onto the
	// keymap while the leaf is active — the two pieces the hotkey path needs.
	scope: new mock.Scope(),
	keymap: {
		__pushed: [],
		pushScope(s) { app.keymap.__pushed.push(s); },
		popScope(s) { app.keymap.__pushed = app.keymap.__pushed.filter((x) => x !== s); },
	},
	// Mirrors the Settings modal as `app.setting`, so the restart path that
	// reopens the plugin tab can be observed.
	setting: {
		open() { app.__events.push("setting:open"); },
		openTabById(id) { app.__events.push("setting:tab:" + id); },
	},
	embedRegistry: {
		_map: new Map(),
		isExtensionRegistered(ext) { return this._map.has(ext); },
		registerExtension(ext, factory) {
			if (this._map.has(ext)) throw new Error("already registered " + ext);
			this._map.set(ext, factory);
		},
		unregisterExtension(ext) { this._map.delete(ext); },
	},
	__writes: [],
	__opens: [],
	__events: [],
	__menus: [],
	__renames: [],
	__promptRename: [],
	__promptDelete: [],
};

globalThis.__APP__ = app;
// Records document-level listeners so the harness can fire a real mousedown
// outside the grid, which is the only way to exercise the deselect handler.
globalThis.__DOC_LISTENERS__ = new Map();
globalThis.document = {
	addEventListener(type, fn) {
		const list = globalThis.__DOC_LISTENERS__.get(type) ?? [];
		list.push(fn);
		globalThis.__DOC_LISTENERS__.set(type, list);
	},
	removeEventListener(type, fn) {
		const list = globalThis.__DOC_LISTENERS__.get(type) ?? [];
		globalThis.__DOC_LISTENERS__.set(type, list.filter((f) => f !== fn));
	},
	/** Fires a document mousedown at `target`, as the browser would. */
	dispatchMousedown(target) {
		for (const fn of globalThis.__DOC_LISTENERS__.get("mousedown") ?? []) {
			fn({ target });
		}
	},
	createElement: (tag) => new mock.FakeEl(tag),
	createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 10 }), detach() {} }),
	activeElement: null,
	body: { classList: { add() {}, remove() {} } },
};
// Window-level listeners are recorded too, so the harness can fire the
// capture-phase Mod+F the view registers as its last line of defence.
globalThis.__WIN_LISTENERS__ = new Map();
globalThis.window = {
	getComputedStyle: () => ({ paddingLeft: "4px", paddingRight: "4px", borderLeftWidth: "1px", borderRightWidth: "1px" }),
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (t) => clearTimeout(t),
	addEventListener(type, fn) {
		const list = globalThis.__WIN_LISTENERS__.get(type) ?? [];
		list.push(fn);
		globalThis.__WIN_LISTENERS__.set(type, list);
	},
	dispatchKeydown(target, event) {
		for (const fn of globalThis.__WIN_LISTENERS__.get("keydown") ?? []) {
			fn({ preventDefault() {}, stopPropagation() {}, ...event, target });
		}
	},
	removeEventListener() {},
};

// package.json declares "type": "module", but the built bundle is CommonJS, so
// it is loaded from a .cjs copy.
const fs = require("node:fs");
const bundleSrc = path.resolve(__dirname, "..", "..", "main.js");
const bundlePath = path.resolve(__dirname, "bundle.cjs");
fs.writeFileSync(bundlePath, fs.readFileSync(bundleSrc));
const mod = require(bundlePath);
const PluginClass = mod.default ?? mod;

const instance = new PluginClass(app, { id: "super-csv-editor", name: "Super CSV Editor" });

(async () => {
	try {
		await instance.onload();
	} catch (err) {
		console.log("ONLOAD THREW:", err && err.stack ? err.stack.split("\n").slice(0, 8).join("\n") : err);
		process.exitCode = 1;
		return;
	}
	console.log("onload ok");
	console.log("views:", [...mock.__registered.views.keys()].join(","));
	console.log("extensions:", JSON.stringify(mock.__registered.extensions));
	console.log("commands:", mock.__registered.commands.map((c) => c.id).join(","));
	console.log("embed csv registered:", app.embedRegistry.isExtensionRegistered("csv"));

	const factory = app.embedRegistry._map.get("csv");
	if (!factory) {
		console.log("NO FACTORY REGISTERED");
		return;
	}

	const container = new mock.FakeEl("div");
	// Obsidian renders the `|alias` of `![[f.csv|5]]` into the container's alt.
	const alias = process.argv[4];
	if (alias !== undefined) container.setAttr("alt", alias);
	const child = factory({ app, containerEl: container }, file, "");
	console.log("factory returned:", child?.constructor?.name);
	await child.loadFile();
	console.log("embed dirty?", child.grid ? child.grid.isDirty() : "no grid");

	const dump = (el, depth = 0) => {
		const cls = [...(el.classList?._values ?? [])].join(".");
		const txt = el.textContent ? JSON.stringify(el.textContent.slice(0, 40)) : "";
		console.log(`${"  ".repeat(depth)}<${el.tagName}${cls ? "." + cls : ""}> ${txt}`);
		for (const c of el.children ?? []) dump(c, depth + 1);
	};
	dump(container);

	// The add affordances must live OUTSIDE the <table>: as a table row/col they
	// inherit the sum of every column width, which is what pushed them out of the
	// window whenever the grid was wider than the viewport.
	const wrap = container.children[0].children[0];
	const table = wrap.children[0];
	const addRow = container.children.find((c) => c.hasClass("super-csv-editor-add-row"));
	const addCol = wrap.children.find((c) => c.hasClass("super-csv-editor-add-col"));
	const inside = (el) => {
		for (let n = el; n; n = n.parentElement) if (n === table) return true;
		return false;
	};
	console.log("--- asserts ---");
	console.log("add-row inside <table>:", addRow ? (inside(addRow) ? "FAIL" : "ok") : "n/a (hidden)");
	console.log("add-col inside <table>:", addCol ? (inside(addCol) ? "FAIL" : "ok") : "n/a (hidden)");
	// When shown, add-row must be a child of the CONTAINER (width:100% = text
	// width) and add-col a child of the WRAPPER (so "+" tracks the table edge).
	console.log("add-row parent is the scroll container:", !addRow ? "n/a (hidden)" : addRow.parentElement === container ? "ok" : "FAIL");
	console.log("add-col parent is the wrapper:", !addCol ? "n/a (hidden)" : addCol.parentElement === wrap ? "ok" : "FAIL");
	console.log("ghost col cells:", table.children[1].children[0].children.filter((c) => c.hasClass("is-ghost-col")).length);
	// The embed must not render the row/column/delimiter readout.
	const statusBars = container.children.filter((c) => c.hasClass("super-csv-editor-status"));
	console.log("status bar in embed:", statusBars.length === 0 ? "ok (none)" : "FAIL");
	// Default settings hide the add strips inside an embed.
	console.log("add-row hidden in embed:", addRow ? "FAIL (present)" : "ok (none)");
	console.log("add-col hidden in embed:", addCol ? "FAIL (present)" : "ok (none)");

	// The full view must KEEP the readout: only the embed drops it.
	const viewFactory = mock.__registered.views.get("super-csv-editor-view");
	const viewLeaf = { app, setViewState() {}, getViewState() { return {}; } };
	// The leaf is the ACTIVE one, which is what makes the view push its Ctrl+F
	// scope onto the keymap when it opens.
	app.workspace.__recentLeaf = viewLeaf;
	app.workspace.activeLeaf = viewLeaf;
	const view = viewFactory(viewLeaf);
	// onOpen runs BEFORE a file is assigned, then loadFile assigns it and calls
	// onLoadFile — the real order, which is what let an empty title slip through.
	await view.onOpen();
	view.file = file;
	await view.onLoadFile(file);
	const viewStatus = view.contentEl.children.filter((c) => c.hasClass("super-csv-editor-status"));
	console.log("status bar in full view:", viewStatus.length === 1 ? "ok (present)" : "FAIL");
	console.log("view status text:", JSON.stringify(viewStatus[0]?.textContent ?? ""));

	// ── The file menu a custom view must build for itself ───────────────────
	// The tab's context menu and the pane's "more options" button both call
	// onPaneMenu. A custom FileView has no file actions of its own, so without
	// this override the CSV menu offered only "Close".
	console.log("--- file menu ---");
	const menu = new mock.Menu();
	view.onPaneMenu(menu, "tab-header");
	const titles = menu.items.map((i) => i.title);
	console.log("menu offers Rename:", titles.includes("Rename") ? "ok" : "FAIL", JSON.stringify(titles));
	console.log("menu offers Delete file:", titles.includes("Delete file") ? "ok" : "FAIL");
	const fileMenus = app.__menus.filter((m) => m.name === "file-menu");
	console.log(
		"file-menu triggered with the source:",
		fileMenus.length === 1 && fileMenus[0].args[2] === "tab-header" ? "ok" : "FAIL",
	);
	menu.items.find((i) => i.title === "Rename")?.callback?.();
	console.log("rename item prompts for a rename:", app.__promptRename.includes(file.path) ? "ok" : "FAIL");

	// ── The editable title, driven for real ─────────────────────────────────
	// A markdown note gets an inline title for free; the CSV view builds its
	// own. Typing a new name and blurring must rename the file in place.
	console.log("--- editable title ---");
	const titleEl = view.contentEl.children.find((c) => c.hasClass("inline-title"));
	console.log("editable title present:", titleEl ? "ok" : "FAIL");
	console.log("title shows the file name:", titleEl?.getText() === "logs" ? "ok" : "FAIL", JSON.stringify(titleEl?.getText()));
	if (titleEl) {
		titleEl.setText("summary");
		titleEl.dispatch("blur", {});
		await new Promise((resolve) => setTimeout(resolve, 0));
		console.log(
			"blur renames the file:",
			app.__renames.some((r) => r.to === "summary.csv") ? "ok" : "FAIL",
			JSON.stringify(app.__renames),
		);
	}

	// A freshly opened grid must not pre-select a cell. A highlight the user
	// never asked for reads as an edit target and gets copied or cleared by a
	// stray Ctrl+C, so this is asserted for BOTH the embed and the full view.
	const walkDom = (el, out = []) => {
		out.push(el);
		for (const c of el.children ?? []) walkDom(c, out);
		return out;
	};
	const highlighted = (root) =>
		walkDom(root).filter((e) => e.hasClass("is-selected") || e.hasClass("is-focused")).length;
	console.log("no cell pre-selected in the full view:", highlighted(view.contentEl) === 0 ? "ok" : "FAIL");
	console.log("no cell pre-selected in the embed:", highlighted(container) === 0 ? "ok" : "FAIL");

	// ── Ctrl+F is wired on a PUSHED scope ───────────────────────────────────
	// Obsidian's Mod+F is `editor:open-search` on the app scope, and the hotkey
	// manager consumes the key for the first matching command even when it
	// cannot run — so a view-scope-only binding never fires. The view must push
	// its scope ABOVE the app scope while its leaf is active.
	console.log("--- find hotkey ---");
	viewLeaf.view = view;
	const pushed = app.keymap.__pushed;
	const topScope = () => pushed[pushed.length - 1] ?? app.scope;
	console.log("the view owns a scope:", view.scope ? "ok" : "FAIL");
	console.log("the scope is pushed while the leaf is active:", pushed.includes(view.scope) ? "ok" : "FAIL");
	console.log("Ctrl+F reaches the view's scope, not the app scope:", topScope() === view.scope ? "ok" : "FAIL");
	const scope = view.scope;
	const scopeKeys = scope ? scope.keys.map((k) => k.key) : [];
	console.log("scope binds Mod+F:", scopeKeys.includes("f") ? "ok" : "FAIL", JSON.stringify(scopeKeys));
	if (scope) {
		const row = walkDom(view.contentEl).find((e) => e.hasClass("super-csv-editor-search"));
		const button = walkDom(view.contentEl).find((e) => e.hasClass("super-csv-editor-search-button"));
		console.log("search row starts hidden:", row && row.hasClass("is-hidden") ? "ok" : "FAIL");
		// The toolbar button toggles the row, rather than only ever opening it.
		button?.dispatch("click", {});
		console.log("Search button opens the row:", row && !row.hasClass("is-hidden") ? "ok" : "FAIL");
		button?.dispatch("click", {});
		console.log("Search button closes it again:", row && row.hasClass("is-hidden") ? "ok" : "FAIL");
		const consumed = scope.handleKey({ preventDefault() {} }, { modifiers: "Ctrl", key: "f", vkey: "KeyF" });
		console.log("Mod+F is consumed (returns false):", consumed === false ? "ok" : "FAIL");
		console.log("Mod+F reveals the search row:", row && !row.hasClass("is-hidden") ? "ok" : "FAIL");
		// A key the scope does not bind must fall through to the app scope
		// (the hotkey manager), not be swallowed by our scope.
		const other = scope.handleKey({ preventDefault() {} }, { modifiers: "Ctrl", key: "s", vkey: "KeyS" });
		console.log("an unbound key falls through:", other === undefined ? "ok" : "FAIL");

		// The window-capture fallback: even if the keymap swallows Mod+F, a
		// keydown from inside the view still opens the box.
		button?.dispatch("click", {}); // make sure it is hidden first
		const cell = walkDom(view.contentEl).find((e) => e.hasClass("super-csv-editor-cell"));
		globalThis.window.dispatchKeydown(cell, { key: "f", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false });
		console.log("Mod+F from inside the view opens the box:", row && !row.hasClass("is-hidden") ? "ok" : "FAIL");
		// A key from OUTSIDE the view must be left alone.
		button?.dispatch("click", {});
		globalThis.window.dispatchKeydown(container, { key: "f", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false });
		console.log("Mod+F from outside the view is ignored:", row && row.hasClass("is-hidden") ? "ok" : "FAIL");
	}

	// ── The Bases-style toolbar + filtering ─────────────────────────────────
	console.log("--- search chrome ---");
	const toolbarButton = walkDom(view.contentEl).find((e) => e.hasClass("super-csv-editor-search-button"));
	console.log("toolbar has a Search button:", toolbarButton ? "ok" : "FAIL");
	console.log(
		"the button is labelled:",
		walkDom(view.contentEl).some((e) => e.hasClass("super-csv-editor-search-button-label") && e.textContent === "Search")
			? "ok"
			: "FAIL",
	);
	console.log("the toolbar count is gone:", walkDom(view.contentEl).some((e) => e.hasClass("super-csv-editor-toolbar-count")) ? "FAIL" : "ok");
	const searchInput = walkDom(view.contentEl).find((e) => e.hasClass("super-csv-editor-search-input"));
	// Filtering: the view feeds the query to the grid, which hides non-matches.
	const viewGrid = view.grid;
	if (viewGrid && searchInput) {
		viewGrid.setFilter("5");
		const rows = walkDom(view.contentEl).filter((e) => e.hasClass("super-csv-editor-row") && !e.hasClass("is-header"));
		const hidden = rows.filter((r) => r.hasClass("is-filtered-out")).length;
		console.log("search hides non-matching rows:", hidden > 0 ? "ok" : "FAIL", `${hidden}/${rows.length} hidden`);
		const counts = viewGrid.filterCounts();
		console.log("filterCounts reports the shown rows:", counts.shown === counts.total - hidden ? "ok" : "FAIL");
		viewGrid.setFilter("");
		console.log("clearing the filter shows every row:", viewGrid.filterCounts().shown === viewGrid.filterCounts().total ? "ok" : "FAIL");
	}


	if (child.grid) {
		const grid = child.grid;

		// ── The keydown path, driven for real ───────────────────────────────
		// Firing a synthetic event through the container's own listener is the
		// only way to prove the KEY HANDLER works; calling editFocusedCell()
		// directly would print "ok" even if Enter were unbound.
		const press = (key, mods = {}) => {
			container.dispatch("keydown", {
				key,
				shiftKey: false,
				ctrlKey: false,
				metaKey: false,
				altKey: false,
				target: container,
				preventDefault() {},
				stopPropagation() {},
				...mods,
			});
		};
		// The handler ignores keys unless the grid owns the focus.
		container.focus();

		// 1. Enter on a selected cell opens the inline editor
		grid.setFocus({ row: 1, col: 0 });
		press("Enter");
		console.log("Enter opens the editor:", grid.editor !== null ? "ok" : "FAIL (no editor)");
		if (grid.editor) grid.cancelEdit();

		// 2. F2 is the documented alternative
		grid.setFocus({ row: 2, col: 1 });
		press("F2");
		console.log("F2 opens the editor:", grid.editor !== null ? "ok" : "FAIL (no editor)");
		if (grid.editor) grid.cancelEdit();

		// 3. Enter typed INSIDE the editor commits and moves down
		grid.setFocus({ row: 1, col: 0 });
		press("Enter");
		if (grid.editor) {
			grid.editor.value = "typed";
			grid.editor.dispatch("keydown", {
				key: "Enter",
				shiftKey: false,
				ctrlKey: false,
				metaKey: false,
				preventDefault() {},
				stopPropagation() {},
			});
			console.log("Enter inside the editor commits:", grid.editor === null ? "ok" : "FAIL (still editing)");
			console.log("  value written to the table:", grid.table.rows[1][0] === "typed" ? "ok" : "FAIL");
			// Enter moves ONE row down (1 -> 2), clamped to the last DRAWN row
			// so a limited embed never lands the focus on a hidden row.
			const expectedRow = Math.min(2, Math.min(5, grid.rowLimit ?? 5) - 1);
			console.log(
				"  focus moved down within the limit:",
				grid.focus.row === expectedRow
					? "ok"
					: `FAIL (row ${grid.focus.row}, expected ${expectedRow})`,
			);
		} else {
			console.log("Enter inside the editor commits: FAIL (editor never opened)");
		}

		// 4. With a cleared selection there is nothing to edit into a cell the
		//    user did not pick, so Enter must not silently edit the stale anchor.
		document.dispatchMousedown(new mock.FakeEl("div"));
		press("Enter");
		console.log("Enter does nothing with no selection:", grid.editor === null ? "ok" : "FAIL (edited anyway)");

		// 5. arrow keys still work after a deselect
		grid.setFocus({ row: 0, col: 0 });
		document.dispatchMousedown(new mock.FakeEl("div"));
		grid.moveFocus("down", false);
		console.log("arrow keys still work after deselect:", grid.focus.row === 1 ? "ok" : `FAIL (row ${grid.focus.row})`);
	}

	// ── Restart keeps the user in Settings ──────────────────────────────────
	// Disabling the plugin tears its settings tab down, so `restartPlugin` must
	// reopen the Settings modal on this plugin's tab; otherwise the restart
	// looks like it dumped the user out of the settings screen.
	app.__events.length = 0;
	await instance.restartPlugin();
	await new Promise((resolve) => setTimeout(resolve, 300));
	console.log("--- restart ---");
	console.log(
		"settings modal reopened:",
		app.__events.includes("setting:open") ? "ok" : "FAIL",
	);
	console.log(
		"settings tab restored:",
		app.__events.includes("setting:tab:super-csv-editor") ? "ok" : "FAIL",
	);
	console.log(
		"disable/enable cycle ran:",
		app.__events.includes("disable:super-csv-editor") && app.__events.includes("enable:super-csv-editor")
			? "ok"
			: "FAIL",
	);

	// ── CSVs in the Quick Switcher's recents ────────────────────────────────
	// The mock only returns the CSV when non-image attachments are requested,
	// which is exactly what Obsidian does. `onload` wraps `getRecentFiles` so
	// the CSV comes back anyway, at its true recency position.
	console.log("--- recent files ---");
	const recent = app.workspace.getRecentFiles({});
	console.log(
		"csv kept in the recents:",
		recent.includes("data/report.csv") ? "ok" : "FAIL",
		JSON.stringify(recent),
	);
	console.log(
		"csv spliced into recency order:",
		recent[1] === "data/report.csv" ? "ok" : "FAIL",
		JSON.stringify(recent[1]),
	);
	const recentOne = app.workspace.getRecentFiles({ maxCount: 1 });
	console.log(
		"maxCount still honoured:",
		recentOne.length === 1 && recentOne[0] === "notes/latest.md" ? "ok" : "FAIL",
		JSON.stringify(recentOne),
	);

})();

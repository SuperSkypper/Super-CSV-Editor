import {
	FileView,
	Menu,
	Notice,
	Scope,
	TFile,
	setIcon,
	type WorkspaceLeaf,
} from "obsidian";
import { isCsvPath, csvGuardMessage, CSV_EXTENSION } from "./guard.ts";
import { newPathAfterRename } from "./fileRename.ts";
import { GridController, CSV_VIEW_TYPE } from "./grid.ts";
import { LinksPanel } from "./linksPanel.ts";
import type { CsvTable } from "../parser/csv.ts";
import type SuperCsvEditorPlugin from "../main.ts";

export { CSV_VIEW_TYPE };

/**
 * `FileManager.promptForFileRename` is what every core "Rename" menu item
 * calls, but it is missing from the public typings. This is the same call the
 * markdown view's own file menu makes.
 */
function promptForFileRename(fileManager: unknown, file: TFile): void {
	(fileManager as { promptForFileRename?(file: TFile): void }).promptForFileRename?.(file);
}

/**
 * Extends FileView (not ItemView) so Obsidian can hand a .csv file to this view
 * through the standard file protocol. An ItemView has no such contract, which
 * is why opening a CSV used to fall through to the OS handler.
 *
 * The view holds no grid logic: it owns a leaf, delegates everything to a
 * `GridController`, and bridges Obsidian's file protocol to the plugin's save
 * queue. `CsvEmbedComponent` mounts the very same controller, which is why an
 * embedded CSV edits, sorts, clips and links exactly like the opened file.
 */
export class CsvView extends FileView {
	private grid: GridController | null = null;
	private gridHost: HTMLElement | null = null;
	private linksPanel: LinksPanel | null = null;
	/** The editable file title shown above the grid, like a note's inline title. */
	private inlineTitleEl: HTMLElement | null = null;
	private headerMenuWired = false;
	/** The Bases-style Search toolbar button and the row it reveals. */
	private searchButtonEl: HTMLElement | null = null;
	private searchRowEl: HTMLElement | null = null;
	private searchInputEl: HTMLInputElement | null = null;
	private searchCountEl: HTMLElement | null = null;
private searchReplaceInputEl: HTMLInputElement | null = null;
	/** Whether the search row is showing, so the button can toggle it. */
	private searchOpen = false;
	/**
	 * The scope carrying Ctrl/Cmd+F. Obsidian's own Mod+F is a command on the
	 * app scope, and `onTrigger` consumes the key for the first matching command
	 * even when that command's check returns undefined — so the ONLY way to win
	 * Ctrl+F is for a scope to sit ABOVE the app scope. That means pushing it
	 * while this leaf is active, and popping it when it is not.
	 */
	private searchScope: Scope | null = null;
	private searchScopePushed = false;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: SuperCsvEditorPlugin,
	) {
		super(leaf);
	}

	// ── FileView protocol ──────────────────────────────────────────────────

	getViewType(): string {
		return CSV_VIEW_TYPE;
	}

	getViewData(): string {
		return this.grid?.getViewData() ?? "";
	}

	/**
	 * Only .csv. Returning true here made Obsidian hand this view EVERY file it
	 * was asked to open, and the view then wrote the parsed result back through
	 * vault.modify() — which is how following a wikilink used to overwrite the
	 * target note with CSV. Refusing here means the view never sees the file.
	 */
	canAcceptExtension(extension: string): boolean {
		return extension.toLowerCase() === CSV_EXTENSION;
	}

	async onLoadFile(file: TFile): Promise<void> {
		// Second line of defence: canAcceptExtension should have kept this file
		// away, so reaching here with a non-CSV means the protocol handed it over
		// anyway. Refuse without reading, so nothing can be written back later.
		if (!isCsvPath(file.path)) {
			new Notice(csvGuardMessage(file.path));
			this.file = null;
			this.grid?.reset();
			this.updateInlineTitle();
			return;
		}

		this.ensureGrid();
		const grid = this.grid;
		if (!grid) return;
		grid.file = file;
		const text = await this.app.vault.read(file);
		grid.loadText(text, this.plugin.settings.delimiter);
		// The grid drops any filter on load, so the box must forget its query
		// too or the two would disagree.
		this.resetSearch();
		this.linksPanel?.setFile(file.path);
		// onOpen runs BEFORE a file is assigned, so the title it built was
		// empty; without this the name only appeared once the title was focused
		// and blurred again.
		this.updateInlineTitle();
	}

	async onUnloadFile(file: TFile): Promise<void> {
		// A refused file has no table worth writing; saving here is what used to
		// flatten a note into CSV on the way out.
		if (!isCsvPath(file.path)) return;
		await this.plugin.saveView(this);
	}

	/**
	 * Fills the menu Obsidian shows for this leaf — the tab's context menu and
	 * the pane's "more options" button both end up here.
	 *
	 * A custom file view does NOT inherit the file actions Obsidian gives its
	 * own views, so without this the CSV's menu offered only "Close". The two
	 * items and the `file-menu` trigger below are exactly what the markdown
	 * view contributes, which is what makes "Rename", "Delete file", "Copy
	 * path", "Show in system explorer" and the rest appear here as well.
	 */
	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		const file = this.file;
		if (!file) return;
		menu.addItem((item) =>
			item
				.setSection("action")
				.setTitle("Rename")
				.setIcon("lucide-edit-3")
				.onClick(() => promptForFileRename(this.app.fileManager, file)),
		);
		menu.addItem((item) =>
			item
				.setSection("danger")
				.setTitle("Delete file")
				.setIcon("lucide-trash-2")
				.setWarning(true)
				.onClick(() => void this.app.fileManager.promptForDeletion(file)),
		);
		this.app.workspace.trigger("file-menu", menu, file, source, this.leaf);
	}

	async onRename(file: TFile): Promise<void> {
		this.grid?.refresh();
		this.updateInlineTitle();
		this.linksPanel?.setFile(file.path);
	}

	/** Redraws from the in-memory table, e.g. when link resolution changed. */
	refresh(): void {
		this.grid?.refresh();
	}

	/**
	 * Adopts the text just written to disk as the saved baseline, so the grid
	 * stops reporting "modified" and external reloads are allowed again.
	 */
	markSaved(text: string): void {
		this.grid?.markSaved(text);
	}

	/**
	 * Pulls the file's current on-disk contents into the grid, because another
	 * program wrote to it. Returns false when the grid had unsaved edits, in
	 * which case the caller leaves it untouched rather than discarding them.
	 */
	async reloadFromDisk(): Promise<boolean> {
		const grid = this.grid;
		const file = this.file;
		if (!grid || !file) return false;
		const text = await this.app.vault.read(file);
		return grid.reload(text);
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────

	async onOpen(): Promise<void> {
		this.ensureGrid();
		this.ensureSearchChrome();
		this.registerSearchScope();
	}

	async onClose(): Promise<void> {
		this.grid?.dispose();
		this.grid = null;
		this.linksPanel?.dispose();
		this.linksPanel = null;
		this.gridHost?.remove();
		this.gridHost = null;
		this.inlineTitleEl = null;
		this.searchButtonEl = null;
		this.searchRowEl = null;
		this.searchInputEl = null;
		this.searchCountEl = null;
		this.searchOpen = false;
	}

	private ensureGrid(): void {
		if (this.grid) return;
		// The grid's render() calls container.empty() on every edit, so it must
		// own a wrapper of its own. The links panel is a SIBLING of that wrapper,
		// not a child of the grid, which is the only reason it survives a
		// keystroke — mounted inside, it would be destroyed on the first edit.
		this.contentEl.addClass("super-csv-editor-window");
		this.ensureInlineTitle();
		// The search chrome sits between the title and the grid, and OUTSIDE the
		// grid's own container: render() empties that container on every edit,
		// so chrome kept inside would vanish on the first keystroke.
		this.ensureSearchChrome();
		this.wireHeaderMenu();
		this.gridHost = this.contentEl.createDiv({ cls: "super-csv-editor-window-main" });
		this.linksPanel = new LinksPanel(this.app, this.contentEl);
		this.grid = new GridController(this.gridHost, this.app, {
			onChange: () => {
				this.plugin.requestSave(this);
				// An edit can move a row in or out of the filter, so the counts
				// in the toolbar and the search row are refreshed with it.
				this.updateSearchCount();
				// The links panel is deliberately NOT refreshed here. It lists
				// backlinks, which are written in OTHER notes, so editing this
				// sheet cannot change it — and rebuilding it mid-click tore the
				// backlink out from under the pointer, so clicking a note while
				// a cell was being edited never opened it. Vault-level changes
				// (a note added, removed or renamed) repaint it through
				// `repaintLinks` in main.ts, which is what actually moves the
				// list.
			},
			getSourcePath: () => this.file?.path,
		});
		this.grid.file = this.file;
		this.grid.mount();
		// A file may already be on the leaf by the time the grid is built.
		this.linksPanel.setFile(this.file?.path ?? null);
	}

	// ── Title & header menu ─────────────────────────────────────────────────

	/**
	 * The editable file title above the grid. A markdown note gets one for
	 * free; a custom view has to build its own, so clicking the name renames
	 * the file here the same way it does in a note: click, type, Enter (or
	 * click away).
	 */
	private ensureInlineTitle(): void {
		if (this.inlineTitleEl) return;
		const titleEl = this.contentEl.createDiv({
			cls: "inline-title super-csv-editor-title",
		});
		titleEl.contentEditable = "true";
		titleEl.spellcheck = false;
		titleEl.tabIndex = -1;
		titleEl.setAttr("enterkeyhint", "done");

		this.registerDomEvent(titleEl, "keydown", (event: KeyboardEvent) => {
			if (event.key === "Enter") {
				event.preventDefault();
				titleEl.blur();
			} else if (event.key === "Escape") {
				event.preventDefault();
				this.updateInlineTitle();
				titleEl.blur();
			}
		});
		this.registerDomEvent(titleEl, "blur", () => {
			void this.commitInlineTitle();
		});

		this.inlineTitleEl = titleEl;
		this.updateInlineTitle();
	}

	private updateInlineTitle(): void {
		this.inlineTitleEl?.setText(this.file?.basename ?? "");
	}

	/**
	 * Renames the file to whatever the title now reads. An unchanged or empty
	 * name is a no-op, so merely focusing and leaving the title costs nothing.
	 */
	private async commitInlineTitle(): Promise<void> {
		const file = this.file;
		const titleEl = this.inlineTitleEl;
		if (!file || !titleEl) return;
		const newPath = newPathAfterRename(file.path, titleEl.getText());
		if (newPath === file.path) {
			this.updateInlineTitle();
			return;
		}
		try {
			await this.app.fileManager.renameFile(file, newPath);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			new Notice(`Could not rename "${file.name}": ${detail}`);
		}
		this.updateInlineTitle();
	}

	/**
	 * Right-clicking the pane's own title bar. Obsidian wires this for its tab
	 * headers but not for the header inside a custom view, so the menu is built
	 * here — the same one the tab and the "more options" button produce.
	 */
	private wireHeaderMenu(): void {
		if (this.headerMenuWired) return;
		this.headerMenuWired = true;
		// `headerEl` is created by the base View but is not in the public typings.
		const headerEl = (this as unknown as { headerEl?: HTMLElement }).headerEl;
		if (!headerEl) return;
		this.registerDomEvent(headerEl, "contextmenu", (event: MouseEvent) => {
			if (!this.file) return;
			const menu = Menu.forEvent(event);
			menu.setParentElement(headerEl);
			this.onPaneMenu(menu, "more-options");
		});
	}

	/** Redraws the links panel from the vault, e.g. after a link-index rebuild. */
	refreshLinksPanel(): void {
		this.linksPanel?.refresh();
	}

	// ── Search (Bases-style) ────────────────────────────────────────────────

	/**
	 * The "Search" button in the toolbar above the grid, plus the "Find..." row
	 * it reveals.
	 *
	 * Modelled on Obsidian Bases: searching FILTERS the sheet down to the rows
	 * that match, rather than jumping between highlights — so the box stays put
	 * and the table shrinks to the results.
	 */
	private ensureSearchChrome(): void {
		if (this.searchRowEl) return;
		const toolbar = this.contentEl.createDiv({ cls: "super-csv-editor-toolbar" });
		// A native clickable-icon look, plus a label: an icon alone left people
		// guessing what the control did. Its aria-label is also the tooltip.
		const button = toolbar.createEl("button", {
			cls: "clickable-icon super-csv-editor-search-button",
		});
		button.type = "button";
		setIcon(button, "search");
		button.createSpan({ cls: "super-csv-editor-search-button-label", text: "Search" });
		button.setAttribute("aria-label", "Search this sheet");
		button.addEventListener("click", () => this.toggleSearch());
		this.searchButtonEl = button;

		const row = this.contentEl.createDiv({ cls: "super-csv-editor-search is-hidden" });
		const icon = row.createSpan({ cls: "super-csv-editor-search-icon" });
		setIcon(icon, "search");
		const input = row.createEl("input", { cls: "super-csv-editor-search-input" });
		input.type = "text";
		input.spellcheck = false;
		input.placeholder = "Find...";
		input.setAttribute("aria-label", "Find rows");
		input.addEventListener("input", () => this.applySearch());
		input.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				this.closeSearch();
				return;
			}
			// Ctrl/Cmd+F again re-selects the box instead of bubbling to the
			// keymap, which would re-run the shortcut for no visible change.
			if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "F")) {
				event.preventDefault();
				input.focus();
				input.select();
			}
		});
		this.searchInputEl = input;
		this.searchCountEl = row.createDiv({ cls: "super-csv-editor-search-count" });
		const replaceInput = row.createEl("input", { cls: "super-csv-editor-search-input" });
		replaceInput.type = "text";
		replaceInput.spellcheck = false;
		replaceInput.placeholder = "Replace...";
		replaceInput.setAttribute("aria-label", "Replace with");
		this.searchReplaceInputEl = replaceInput;
		const replaceAllBtn = row.createEl("button", { cls: "clickable-icon super-csv-editor-search-replace-all" });
		replaceAllBtn.type = "button";
		replaceAllBtn.setText("Replace all");
		replaceAllBtn.setAttribute("aria-label", "Replace all matches");
		replaceAllBtn.addEventListener("click", () => {
			const query = this.searchInputEl?.value ?? "";
			const replacement = replaceInput.value;
			const n = this.grid?.replaceAll(query, replacement) ?? 0;
			this.applySearch();
			this.updateSearchCount();
			new Notice(n === 0 ? "No matches" : `Replaced ${n}`);
		});
		this.searchRowEl = row;
	}

	/**
	 * Binds Ctrl/Cmd+F to the search box.
	 *
	 * The scope is assigned to `this.scope` (the documented view hotkey slot)
	 * AND pushed onto the keymap while this leaf is active. The push is what
	 * actually wins: Obsidian binds Mod+F to `editor:open-search` on the app
	 * scope, and the hotkey manager consumes the key for that command whether or
	 * not it can run — so a view-scope-only binding never gets a look in. Popping
	 * it when the leaf goes inactive is what lets a note keep its own Ctrl+F.
	 */
	private registerSearchScope(): void {
		if (this.searchScope) return;
		const scope = new Scope(this.app.scope);
		scope.register(["Mod"], "f", (event: KeyboardEvent) => {
			event.preventDefault();
			this.openSearch();
			// Returning false CONSUMES the key, so Obsidian's own Mod+F does not
			// also fire.
			return false;
		});
		this.searchScope = scope;
		this.scope = scope;
		this.register(() => this.setSearchScopeActive(false));
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf: WorkspaceLeaf | null) => {
				this.setSearchScopeActive(leaf === this.leaf);
			}),
		);
		// A restored layout can make a CSV tab active without emitting the
		// event; focusing the view is proof enough that it is the one in front.
		this.registerDomEvent(this.containerEl, "focusin", () => this.setSearchScopeActive(true));
		// Last line of defence, and the most reliable one: handle Mod+F on the
		// window in the capture phase whenever it comes from inside this view.
		// Obsidian's keymap runs first but only calls `stopPropagation` (not
		// `stopImmediatePropagation`), so this listener still fires even when
		// the keymap has already "consumed" the key for its own editor search.
		this.registerDomEvent(
			window,
			"keydown",
			(event: KeyboardEvent) => {
				if (event.key !== "f" && event.key !== "F") return;
				if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
				const target = event.target as Node | null;
				if (!target || !this.containerEl.contains(target)) return;
				event.preventDefault();
				this.openSearch();
			},
			{ capture: true },
		);
		// eslint-disable-next-line @typescript-eslint/no-deprecated -- getMostRecentLeaf cannot tell "is THIS leaf active".
		this.setSearchScopeActive(this.app.workspace.activeLeaf === this.leaf);
	}

	private setSearchScopeActive(active: boolean): void {
		const scope = this.searchScope;
		if (!scope) return;
		if (active && !this.searchScopePushed) {
			this.app.keymap.pushScope(scope);
			this.searchScopePushed = true;
		} else if (!active && this.searchScopePushed) {
			this.app.keymap.popScope(scope);
			this.searchScopePushed = false;
		}
	}

	/** Shows the search row if it is hidden, hides it if it is already up. */
	toggleSearch(): void {
		if (this.searchOpen) this.closeSearch();
		else this.openSearch();
	}

	/** Reveals the search row and puts the caret in it. */
	openSearch(): void {
		const row = this.searchRowEl;
		const input = this.searchInputEl;
		if (!row || !input) return;
		row.removeClass("is-hidden");
		this.searchOpen = true;
		// The button reads as "on" while the box is up, the way a toggled icon
		// control does everywhere else in Obsidian.
		this.searchButtonEl?.addClass("is-active");
		input.focus();
		input.select();
	}

	/** Hides the search row and drops the filter, so the whole sheet returns. */
	closeSearch(): void {
		if (!this.searchRowEl) return;
		this.searchRowEl.addClass("is-hidden");
		this.searchOpen = false;
		this.searchButtonEl?.removeClass("is-active");
		if (this.searchInputEl) this.searchInputEl.value = "";
if (this.searchReplaceInputEl) this.searchReplaceInputEl.value = "";
		this.grid?.setFilter("");
		this.updateSearchCount();
		this.gridHost?.focus();
	}

	/** Clears the box without stealing focus; used when a new file is loaded. */
	private resetSearch(): void {
		if (this.searchInputEl) this.searchInputEl.value = "";
if (this.searchReplaceInputEl) this.searchReplaceInputEl.value = "";
		this.searchRowEl?.addClass("is-hidden");
		this.searchOpen = false;
		this.searchButtonEl?.removeClass("is-active");
		this.updateSearchCount();
	}

	private applySearch(): void {
		this.grid?.setFilter(this.searchInputEl?.value ?? "");
		this.updateSearchCount();
	}

	/**
	 * Keeps the search row's readout in step with the grid: how many of the
	 * sheet's rows the filter kept.
	 */
	private updateSearchCount(): void {
		const query = this.searchInputEl?.value ?? "";
		const filtered = query.trim() !== "";
		const { shown, total } = this.grid?.filterCounts() ?? { shown: 0, total: 0 };
		if (this.searchCountEl) {
			this.searchCountEl.setText(
				!filtered ? "" : shown === 0 ? "No results" : `${shown} of ${total} rows`,
			);
		}
	}

	// ── Delegated actions (commands, menus, plugins) ────────────────────────

	addRow(): void {
		this.grid?.addRow();
	}

	removeRow(): void {
		this.grid?.removeRow();
	}

	addColumn(): void {
		this.grid?.addColumn();
	}

	addRowAtEnd(): void {
		this.grid?.addRowAtEnd();
	}

	addColumnAtEnd(): void {
		this.grid?.addColumnAtEnd();
	}

	removeColumn(): void {
		this.grid?.removeColumn();
	}

	moveRowUp(): void {
		this.grid?.moveRowUp();
	}

	moveRowDown(): void {
		this.grid?.moveRowDown();
	}

	moveColumnLeft(): void {
		this.grid?.moveColumnLeft();
	}

	moveColumnRight(): void {
		this.grid?.moveColumnRight();
	}

	editFocusedCell(): void {
		this.grid?.editFocusedCell();
	}

	undo(): void {
		this.grid?.undo();
	}

	redo(): void {
		this.grid?.redo();
	}

	isDirty(): boolean {
		return this.grid?.isDirty() ?? false;
	}

	/** The parsed table, for link scanning. */
	getTable(): CsvTable | null {
		return this.grid?.getTable() ?? null;
	}
}
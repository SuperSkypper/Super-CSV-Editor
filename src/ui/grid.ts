import {
	Modal,
	Notice,
	Setting,
	Menu,
	type App,
	type TFile,
} from "obsidian";
import { detectDelimiter } from "../parser/detect.ts";
import {
	columnCount,
	parseCsv,
	stringifyCsv,
	type CsvTable,
} from "../parser/csv.ts";
import {
	clone,
	deleteColumns,
	deleteRows,
	insertColumn,
	insertRow,
	moveColumn,
	moveRow,
	renameColumn,
	setCell,
	setCellInPlace,
	reindexRagged,
	sortRows,
} from "../parser/table.ts";
import {
	clampFocus,
	nextFocus,
	skipHiddenRows,
	type Direction,
	type Focus,
} from "./navigation.ts";
import { matchingRowIndexes } from "./filter.ts";
import {
	clearedSelection,
	rangeBetween,
	selectedCells,
	shiftTo,
	toggleExtra,
	isSelected,
	type Selection,
} from "./selection.ts";
import { formatDisplayValue, stripInvisible } from "./format.ts";
import { splitWikilinks } from "./wikilinks.ts";
import {
	canPasteGrid,
	clearCells,
	isMarkdownTable,
	parseMarkdownTable,
	copyToClipboard,
	cutToClipboard,
	parseClipboardGrid,
	pasteGrid,
	fillSelection,
} from "./clipboard.ts";
import { isCsvPath } from "./guard.ts";
import { LinkSuggestPopover } from "./linkSuggestPopover.ts";
import { linkResolution } from "./linkResolution.ts";
import { clampVisibleRow, visibleRowCount, type RowLimit } from "./rowLimit.ts";
import {
	widestTextsByColumn,
	widestTextInColumn,
	resizeWidth,
	clampColumnWidth,
	DEFAULT_COLUMN_WIDTH,
	GHOST_COLUMN_WIDTH,
	MIN_COLUMN_WIDTH,
	type ColumnWidthLimits,
	type ManualWidths,
} from "./columns.ts";

/** Class of the inline cell editor; gesture guards exempt it by selector. */
export const EDITOR_CLASS = "super-csv-editor-cell-editor";

/** Matches the inline cell editor, wherever the gesture was aimed. */
export const EDITOR_SELECTOR = `.${EDITOR_CLASS}`;

/**
 * Obsidian renders its own menus, modals, suggestion lists and popovers
 * outside the grid. A click in one of them is not "clicking away from the
 * grid", so the selection must survive it.
 */
const OVERLAY_SELECTORS = [
	".menu-container",
	".menu",
	".modal-container",
	".suggestion-container",
	".popover",
];

function isObsidianOverlay(target: EventTarget | null): boolean {
	const el = target as Element | null;
	if (!el || typeof el.closest !== "function") return false;
	return OVERLAY_SELECTORS.some((selector) => el.closest(selector) !== null);
}

/**
 * True when the keystroke is aimed at somewhere the user types: a text field,
 * a `<select>`, or any editable box. The grid's keyboard lock must let these
 * through — the rename-column dialog (and the quick switcher, search boxes and
 * so on) live outside the grid, so a cell selection left the lock swallowing
 * every character and the field could not be written in.
 */
function isTextEntry(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el || typeof el.closest !== "function") return false;
	if (el.isContentEditable) return true;
	return el.closest("input, textarea, select, [contenteditable]") !== null;
}

export const CSV_VIEW_TYPE = "super-csv-editor-view";

/**
 * Extra pixels per column so a measured width never lands a pixel short.
 *
 * Under `table-layout: fixed` a cell's client width is border-box, so a column
 * sized to exactly text + padding + its own borders is still one border short:
 * the adjacent cell's border consumes the last pixel and the final character
 * renders as an ellipsis. Verified against the vault's own CSVs, where every
 * column clipped by exactly this amount.
 */
const CELL_BORDER_SLACK_PX = 2;

/** How many undo steps are kept. */
const UNDO_LIMIT = 50;

/**
 * Width of the row-number gutter on the left.
 *
 * It is presentation only: the numbers are never part of the CSV, so the gutter
 * is not a column of the table and cannot be edited or serialised.
 */
const GUTTER_WIDTH_PX = 46;

/**
 * What the grid needs from its owner. The standalone file view and the
 * `![[file.csv]]` embed both supply this, which is what makes the embed behave
 * exactly like the opened file instead of a read-only preview.
 */
export interface GridHost {
	/** Called after every mutation that changed the data, to schedule a save. */
	onChange(): void;
	/** The note a wikilink click resolves against, as a vault path. */
	getSourcePath(): string | undefined;
	/** Opens the search bar scoped to a single column, when the host has one. */
	onSearchColumn?(col: number): void;
	/** Optional min/max column width bounds (in px) from plugin settings. */
	getColumnWidthLimits?(): Partial<ColumnWidthLimits>;
}

/** Presentation options an embed can override. The full view uses none. */
export interface GridOptions {
	/**
	 * Whether to draw the "+ New row" and "+" add-column strips. An embed
	 * defaults them off so the table reads as a table; the context menus
	 * still insert rows and columns.
	 */
	showAddButtons?: boolean;
}

/**
	 * `![[file.csv|5]]`: the alias Obsidian puts on the embed container, read
	 * by the caller and already parsed.
	 */
	export interface EmbedLimits {
	rowLimit: RowLimit;
}

/**
 * A file the grid can be serialised back to. `saveView`/`requestSave` in the
 * plugin only need these three members, so a view and an embed share them.
 */
export interface CsvSource {
	readonly file: TFile | null;
	getViewData(): string;
	isDirty(): boolean;
	/**
	 * Adopts the text just written to disk as the saved baseline. Optional so a
	 * host that predates the call, or a test double, still satisfies the type.
	 */
	markSaved?(savedText: string): void;
}

class RenameColumnModal extends Modal {
	private value: string;

	constructor(app: App, initial: string, private onSubmit: (name: string) => void) {
		super(app);
		this.value = initial;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl)
			.setName("Column name")
			.addText((text) => {
				text.setValue(this.value);
				text.setPlaceholder("Column name").onChange((v) => (this.value = v));
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						this.submit();
					}
				});
				window.setTimeout(() => {
					text.inputEl.focus();
					text.inputEl.select();
				}, 0);
			});
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b.setButtonText("Rename").setCta().onClick(() => this.submit()),
			);
	}

	private submit(): void {
		this.onSubmit(this.value);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * The CSV grid: rendering, focus, selection, inline editing, clipboard,
 * undo/redo, column sizing, reordering and sorting.
 *
 * It is deliberately not a view. Both `CsvView` (a standalone tab) and
 * `CsvEmbedComponent` (an `![[file.csv]]` inside a note) own one of these, so
 * every feature lives in exactly one place and the embed cannot drift from the
 * full view.
 */
export class GridController implements CsvSource {
	private table: CsvTable = { headers: [], rows: [], raggedRows: [] };
	private delimiter = ",";
	private focus: Focus = { row: 0, col: 0 };
	/**
	 * Null means nothing is selected — which is also the state a freshly opened
	 * grid starts in. Clicking outside the grid clears it, in the standalone
	 * view as well as inside an embed.
	 */
	private selection: Selection | null = null;
	private original = "";
	/** Cached dirty flag so `updateStatus()` does not re-serialise the whole CSV. */
	private dirty = false;
	private editor: HTMLTextAreaElement | null = null;
	private editorOrigin: Focus | null = null;
	/** A redraw asked for mid-edit, held until the editor closes. */
	private refreshPending = false;
	/** The `[[` autocomplete for the open cell editor, if any. */
	private suggest: LinkSuggestPopover | null = null;
	private rowEls: HTMLElement[] = [];
	private cellByKey = new Map<string, HTMLElement>();
	private paintedSelected = new Set<HTMLElement>();
	private paintedFocused: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private flashTimer: number | null = null;
	/** Whether this grid shows the status bar; false inside an embed. */
	private showStatus = true;
	/**
	 * Whether to add the slack-filler column. The full view needs it (it stops
	 * the leftover width being shared between the real columns); an embed must
	 * NOT have it, because a filler that claims all the space prevents the embed
	 * from shrink-wrapping around its table. Tied to `showStatus`, which already
	 * distinguishes the two hosts.
	 */
	private fillSlack = true;
	/**
	 * How many rows to DRAW, from `![[file.csv|5]]`. Null shows every row.
	 * The parsed table is never truncated: the limit is presentation only,
	 * so editing inside a limited embed still writes the whole file.
	 */
	private rowLimit: RowLimit = null;
	/** Whether the "+ New row" / "+" strips are drawn. */
	private showAddButtons = true;
	private dragging = false;
	/** Set when a column-header drag actually moved; cleared on the next mouseup. */
	private wasColumnDragged = false;
	private manualWidths: ManualWidths = {};
	private undoStack: CsvTable[] = [];
	private redoStack: CsvTable[] = [];
	private detachKeydown: (() => void) | null = null;
	private detachOutsideClick: (() => void) | null = null;
	/** Removes the document-level keyboard lock listener; torn down on dispose. */
	private detachKeyboardLock: (() => void) | null = null;
	/** Clears the cell drag-selection flag on mouseup; torn down on dispose. */
	private detachDragEnd: (() => void) | null = null;
	/** Re-anchors the "+" when the table's width changes; torn down on dispose. */
	private addColObserver: ResizeObserver | null = null;
	/** Re-pins the "+" strip; set by anchorAddColumn, called by a live resize. */
	private repinAddColumn: (() => void) | null = null;
	/** Re-anchors the "+ New row" bar; torn down on dispose. */
	private addRowObserver: ResizeObserver | null = null;
	/** Removes the "+ New row" bar's scroll listener; torn down on dispose. */
	private detachAddRowScroll: (() => void) | null = null;
	/** Removes the "+ new column" strip's scroll listener; torn down on dispose. */
	private detachAddColScroll: (() => void) | null = null;

	/**
	 * The search filter driving which rows are drawn.
	 *
	 * The search box itself lives in the view's chrome (a Bases-style toolbar),
	 * not in the grid, so the same server serves the standalone view only. The
	 * grid just needs to know the query to hide the rows that do not match; an
	 * embed never sets one, so it always draws every row.
	 */
	private filterQuery = "";
	/** Column index the search filter is scoped to, or null for all columns. */
	private filterColumn: number | null = null;
	/** Data rows the active filter hides, recomputed on every render. */
	private hiddenRows = new Set<number>();

	constructor(
		private containerEl: HTMLElement,
		private app: App,
		private host: GridHost,
	) {}

	/** The file this grid writes to, when the owner has one. */
	file: TFile | null = null;

	// ── Lifecycle ─────────────────────────────────────────────────────────

	/**
	 * Starts listening for keys. The container is not a text field, so without a
	 * tabindex it never becomes document.activeElement and no shortcut reaches
	 * the handler.
	 */
	mount(): void {
		if (this.detachKeydown) return;
		this.containerEl.tabIndex = -1;
		const handler = (event: KeyboardEvent): void => this.onGridKeydown(event);
		this.containerEl.addEventListener("keydown", handler);
		this.detachKeydown = () => this.containerEl.removeEventListener("keydown", handler);

		// On the document in the capture phase, because the click that should
		// clear the selection usually happens OUTSIDE this container and would
		// never reach a listener bound to it.
		const outside = (event: MouseEvent): void => {
			this.onOutsidePointer(event);
		};
		document.addEventListener("mousedown", outside, true);
		this.detachOutsideClick = () =>
			document.removeEventListener("mousedown", outside, true);

		// Keyboard lock: whenever a cell is selected or an editor is open,
		// Obsidian's own shortcuts (command palette, note navigation, etc.)
		// must not fire while the user is working in the grid.
		//
		// Events that land INSIDE the grid are left completely alone: this is a
		// capture-phase listener, so it runs BEFORE the cell and editor
		// handlers. Stopping one of those here would silently kill typing in
		// the cell editor — which is exactly what happened when this blocked
		// unconditionally. Only keys arriving from OUTSIDE are consumed.
		const lock = (event: KeyboardEvent): void => {
			if (this.containerEl.contains(event.target as Node)) return;
			// Keys aimed at a text field or an Obsidian overlay belong to that
			// field/menu, not to the grid. This is what lets the rename-column
			// dialog be typed into while a cell is still selected.
			if (isTextEntry(event.target) || isObsidianOverlay(event.target)) return;
			// Escape while an editor is open must reach the editor's own
			// handler, which calls cancelEdit(). Consuming it here instead
			// would leave the editor open — the key never gets a chance to
			// do what it is bound to.
			if (this.editor !== null) return;
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				this.deselect();
				return;
			}
			if (this.selection !== null) {
				event.preventDefault();
				event.stopPropagation();
			}
		};
		document.addEventListener("keydown", lock, true);
		this.detachKeyboardLock = () =>
			document.removeEventListener("keydown", lock, true);

		// The drag-selection flag is raised on a cell's mousedown, but nothing
		// lowered it again, so it stayed true for the rest of the session. The
		// hover handler only extends the selection while a button is held, which
		// hid the leak — but any primary-button drag that happened to pass over
		// the grid would select cells. Clearing it on every mouseup closes that.
		const endDrag = (): void => {
			this.dragging = false;
		};
		window.addEventListener("mouseup", endDrag);
		this.detachDragEnd = () => window.removeEventListener("mouseup", endDrag);
	}

	dispose(): void {
		this.detachKeydown?.();
		this.detachKeydown = null;
		this.detachOutsideClick?.();
		this.detachOutsideClick = null;
		this.detachKeyboardLock?.();
		this.detachKeyboardLock = null;
		this.detachDragEnd?.();
		this.detachDragEnd = null;
		this.addColObserver?.disconnect();
		this.addColObserver = null;
		this.repinAddColumn = null;
		this.addRowObserver?.disconnect();
		this.addRowObserver = null;
		this.detachAddRowScroll?.();
		this.detachAddRowScroll = null;
		this.detachAddColScroll?.();
		this.detachAddColScroll = null;
		if (this.flashTimer !== null) {
			window.clearTimeout(this.flashTimer);
			this.flashTimer = null;
		}
		this.rowEls = [];
		this.cellByKey.clear();
		this.paintedSelected.clear();
		this.paintedFocused = null;
		this.undoStack = [];
		this.redoStack = [];
		// The popover is attached to document.body, not to the container, so
		// nothing else removes it and it would outlive the grid.
		this.suggest?.close();
		this.suggest = null;
	}

	/** Parses raw file text into the grid and resets history and selection. */
	loadText(
		text: string,
		delimiterSetting: string,
		showStatus = true,
		rowLimit: RowLimit = null,
		showAddButtons = true,
	): void {
		this.original = text;
		this.delimiter =
			delimiterSetting === "auto" ? detectDelimiter(text) : delimiterSetting;
		this.table = parseCsv(text, this.delimiter);
		this.undoStack = [];
		this.redoStack = [];
		// Opening a file must not pre-select a cell: a highlight the user never
		// asked for reads as an edit target and gets copied or cleared by a
		// stray Ctrl+C. The focus anchor still starts at the first cell, so
		// arrow keys work immediately without selecting anything.
		this.focus = { row: 0, col: 0 };
		this.selection = null;
		// The search filter belongs to the file that was open, so a different
		// file arrives unfiltered (the view also clears its own search box).
		this.filterQuery = "";
		this.filterColumn = null;
		this.hiddenRows = new Set();
		// Widths are per-column, so they cannot carry over to a different file.
		this.manualWidths = {};
		this.showStatus = showStatus;
		// An embed renders no status bar, and by the same token no slack filler:
		// it is the flag that already says "this is inside a note".
		this.fillSlack = showStatus;
		this.rowLimit = rowLimit;
		this.showAddButtons = showAddButtons;
		this.render(showStatus);
		// Normalise the baseline to what the grid actually serialises, so a
		// byte-for-byte round-trip mismatch can never leave a freshly opened file
		// reporting "modified" (and saving on close) without an edit.
		this.original = this.getViewData();
		this.dirty = false;
	}

	/**
	 * Re-renders unless a cell is being edited, in which case the rebuild is
	 * DEFERRED until the edit is committed.
	 *
	 * `render()` throws the whole grid away, so calling it while the inline
	 * editor is open destroys the textarea and loses whatever the user had
	 * typed. Every redraw that is driven by something OUTSIDE the grid — the
	 * metadata cache's "resolved"/"rename" repaints, a settings toggle — goes
	 * through here, so an edit in progress is never yanked away mid-keystroke.
	 */
	private renderOrDefer(): void {
		if (this.editor) {
			this.refreshPending = true;
			return;
		}
		this.render(this.showStatus);
	}

	/**
	 * Applies both chrome toggles in one render, so an embed reacting to a
	 * settings change rebuilds the grid once instead of twice.
	 */
	applyChrome(options: { showAddButtons: boolean; showStatus: boolean }): void {
		if (
			this.showAddButtons === options.showAddButtons &&
			this.showStatus === options.showStatus
		) {
			return;
		}
		this.showAddButtons = options.showAddButtons;
		this.showStatus = options.showStatus;
		// Keep the filler in step: it follows the status bar as the "am I an
		// embed?" flag, and a stale value here would leave a filler in an embed
		// (stopping its shrink-wrap) or drop it from the full view.
		this.fillSlack = options.showStatus;
		this.renderOrDefer();
	}

	setRowLimit(limit: RowLimit): void {
		if (this.rowLimit === limit) return;
		this.rowLimit = limit;
		// The limit can now hide the focused row, e.g. when it shrank.
		const visible = this.visibleRows();
		this.focus = { ...this.focus, row: clampVisibleRow(this.focus.row, visible) };
		this.renderOrDefer();
	}

	/** Re-renders from the current table, e.g. after settings changed. */
	refresh(): void {
		this.renderOrDefer();
	}

	/**
	 * Updates resolved/unresolved styling on rendered wikilinks in place,
	 * without rebuilding the entire table DOM.
	 */
	refreshLinks(): void {
		const links = this.containerEl.querySelectorAll<HTMLElement>(
			".super-csv-editor-wikilink",
		);
		for (let i = 0; i < links.length; i++) {
			const link = links[i];
			const target = link?.dataset.target;
			if (!link || !target) continue;
			link.classList.toggle("is-unresolved", !this.resolvesToFile(target));
		}
	}

	/**
	 * Applies the search filter in place by toggling `is-filtered-out` on the
	 * existing row elements — avoiding a full table DOM rebuild on every
	 * keystroke in the search box.
	 */
	setFilter(query: string, column: number | null = null): void {
		if (this.filterQuery === query && this.filterColumn === column) return;
		this.filterQuery = query;
		this.filterColumn = column;
		this.recomputeFilter();
		for (let row = 0; row < this.rowEls.length; row++) {
			this.rowEls[row]?.classList.toggle(
				"is-filtered-out",
				this.hiddenRows.has(row),
			);
		}
		this.paint();
		this.updateStatus();
	}

	/**
	 * How many rows the filter shows, and how many exist, for the count readout.
	 *
	 * Derived from the query rather than from `hiddenRows` so it is correct even
	 * before the next render has run — `renderOrDefer` may have deferred the
	 * rebuild, and the readout must not lag a frame behind the box.
	 */
	filterCounts(): { shown: number; total: number } {
		const total = this.visibleRows();
		if (this.filterQuery.trim() === "") return { shown: total, total };
		const shown = matchingRowIndexes(
			this.table,
			this.filterQuery,
			this.filterColumn,
		).filter((row) => row < total).length;
		return { shown, total };
	}

	/**
	 * Re-reads the file's text into the grid because something outside Obsidian
	 * changed it (an editor, a script, a sync client).
	 *
	 * `loadText` is for opening a file: it resets widths, undo and selection,
	 * which is correct on open and wrong on a reload — throwing away the user's
	 * column sizing because another program touched the file is a regression
	 * they did not ask for. This keeps both, and only the scroll position is
	 * re-pinned by the render. It returns false when the grid is skipped
	 * (unsaved edits would otherwise be silently discarded), which is the
	 * caller's cue to leave the view alone.
	 */
	reload(text: string): boolean {
		// Never rebuild the grid out from under an open cell editor: the render
		// below destroys the textarea, so reloading mid-typing would silently
		// discard whatever the user had already entered.
		if (this.editor) return false;
		// The grid holds edits the file does not have yet. Overwriting them
		// with the on-disk text would lose work, so a dirty grid is left alone
		// and the save queue will write its version over the external change.
		if (this.isDirty()) return false;
		// Nothing to do when the on-disk bytes already match our baseline. This
		// is the common case for the plugin's OWN writes: `vault.modify` fires
		// the same "modify" event an external editor would, and reparsing there
		// cleared undo/redo (and re-rendered) after every single save.
		if (text === this.original) return true;
		this.original = text;
		this.table = parseCsv(text, this.delimiter);
		this.undoStack = [];
		this.redoStack = [];
this.render(this.showStatus);
		// Normalise the baseline like loadText, so own writes do not look dirty.
		this.original = this.getViewData();
		this.dirty = false;
		return true;
	}

	/** Empties the grid without writing anything back. */
	reset(): void {
		this.table = { headers: [], rows: [], raggedRows: [] };
		this.original = "";
		this.dirty = false;
		this.undoStack = [];
		this.redoStack = [];
		// An emptied grid has nothing to select, and leaving a stale rectangle
		// around would make the next file open with a highlight on it.
		this.focus = { row: 0, col: 0 };
		this.selection = null;
		this.render(this.showStatus);
	}

	// ── Serialisation ─────────────────────────────────────────────────────

	getViewData(): string {
		return stringifyCsv(this.table, this.delimiter);
	}

	/** The parsed table, so the owner can scan it for wikilinks. */
	getTable(): CsvTable {
		return this.table;
	}

	/**
	 * The cells currently selected, as a flat list.
	 *
	 * `selection` itself stays private because it is a rectangle of anchor/head
	 * coordinates whose meaning depends on how it was built; this hands out the
	 * resolved cells instead, which is what every caller actually wants (the
	 * clipboard, the context menus, and the tests).
	 */
	getSelectedCells(): Focus[] {
		return selectedCells(this.selection, this.hiddenRows);
	}

	isDirty(): boolean {
		return this.dirty;
	}

	/**
	 * Adopts `savedText` as the baseline `isDirty` compares against.
	 *
	 * Called once a vault write succeeds. Without it the reference stayed at the
	 * text loaded at open time, so the grid reported "modified" forever — which
	 * also made `reload` refuse every external change, because it treats a dirty
	 * grid as unsaved work it must not throw away.
	 *
	 * If the grid moved on while the write was in flight the newer edit is
	 * still unsaved, so the baseline is only adopted when the grid still
	 * matches what was actually written.
	 */
	markSaved(savedText: string): void {
		if (this.getViewData() !== savedText) return;
		this.original = savedText;
		this.dirty = false;
		this.updateStatus();
	}

	// ── Focus & selection ──────────────────────────────────────────────────

	/** How many rows the grid may draw, after the embed row limit. */
	private visibleRows(): number {
		return visibleRowCount(this.table.rows.length, this.rowLimit);
	}

	/**
	 * Rebuilds the hidden-row set from the table and the search query. Only the
	 * rows the grid would draw are considered, so the set describes exactly
	 * what is on screen — and an empty query costs nothing.
	 */
	private recomputeFilter(): void {
		const hidden = new Set<number>();
		if (this.filterQuery.trim() !== "") {
			const shown = new Set(
				matchingRowIndexes(this.table, this.filterQuery, this.filterColumn),
			);
			const rows = this.visibleRows();
			for (let row = 0; row < rows; row++) if (!shown.has(row)) hidden.add(row);
		}
		this.hiddenRows = hidden;
	}

	private size() {
		// Navigation must stop at the last DRAWN row, or arrow-down walks
		// into rows a limited embed is not showing.
		return { rows: this.visibleRows(), cols: columnCount(this.table) };
	}

	/**
	 * Moving focus never rebuilds the grid. Re-rendering every cell on each
	 * click is what makes grid editors feel sluggish on large files.
	 */
	/**
	 * Moves the selection. Public so the harness can drive the grid
	 * without synthesising a real mouse event.
	 */
	setFocus(focus: Focus, extend = false, additive = false): void {
		// A null selection has no anchor to extend, so shift/ctrl start fresh.
		const base = this.selection ?? { anchor: focus, focus, extras: [] };
		const next = clampFocus(focus, this.size());
		if (extend) {
			this.selection = shiftTo(base, next);
		} else if (additive) {
			this.selection = { ...toggleExtra(base, next), focus: next };
		} else {
			this.selection = { anchor: next, focus: next, extras: [] };
		}
		this.focus = next;
		this.paint();
	}

	/**
	 * The row index when the selection is a single whole row (every column),
	 * else null. A whole row is a band, so Arrow Up/Down must slide the band
	 * down the sheet instead of collapsing it to one cell.
	 */
	private fullRowSelected(): number | null {
		const cells = this.getSelectedCells();
		const cols = columnCount(this.table);
		if (cols === 0 || cells.length !== cols) return null;
		const row = cells[0]?.row;
		if (row === undefined) return null;
		return cells.every((c) => c.row === row) ? row : null;
	}

	/** Mirror of fullRowSelected for a single whole column. */
	private fullColumnSelected(): number | null {
		const cells = this.getSelectedCells();
		const rows = this.visibleRows() - this.hiddenRows.size;
		if (rows === 0 || cells.length !== rows) return null;
		const col = cells[0]?.col;
		if (col === undefined) return null;
		return cells.every((c) => c.col === col) ? col : null;
	}

	/**
	 * Steps a target focus past the rows the active filter hides, so the caret
	 * never lands on a row that is not on screen.
	 */
	private skipHidden(from: Focus, to: Focus, direction: Direction): Focus {
		// Always delegated, even with nothing hidden: the band move passes an
		// unclamped row (`row + step`), and it is `skipHiddenRows`' in-range
		// check that turns "off the top/bottom" back into "stay put".
		return skipHiddenRows(from, to, direction, this.visibleRows(), (row) =>
			this.hiddenRows.has(row),
		);
	}

	moveFocus(direction: Direction, extend: boolean): void {
		// Sliding a whole row/column selection. Shift is left to the normal
		// extend path so Shift+Arrow still grows the selection.
		if (!extend) {
			if (direction === "down" || direction === "up") {
				const row = this.fullRowSelected();
				if (row !== null) {
					const step = direction === "down" ? 1 : -1;
					const at = this.skipHidden(
						{ row, col: 0 },
						{ row: row + step, col: 0 },
						direction,
					).row;
					if (at !== row) this.selectRow(at);
					return;
				}
			} else if (direction === "left" || direction === "right") {
				const col = this.fullColumnSelected();
				if (col !== null) {
					const step = direction === "right" ? 1 : -1;
					const at = Math.max(0, Math.min(columnCount(this.table) - 1, col + step));
					if (at !== col) this.selectColumn(at);
					return;
				}
			}
		}
		const next = this.skipHidden(
			this.focus,
			nextFocus(this.focus, this.size(), direction),
			direction,
		);
		this.setFocus(next, extend, false);
	}

	private paint(): void {
		const nextSelected = new Set<HTMLElement>();
		for (const c of this.getSelectedCells()) {
			const el = this.cellByKey.get(`${c.row}:${c.col}`);
			if (el) nextSelected.add(el);
		}
		// Only touch cells whose selection state actually changed — O(selected)
		// instead of scanning every cell in the sheet on each arrow key or drag.
		for (const el of this.paintedSelected) {
			if (!nextSelected.has(el)) el.classList.remove("is-selected");
		}
		for (const el of nextSelected) {
			if (!this.paintedSelected.has(el)) el.classList.add("is-selected");
		}
		this.paintedSelected = nextSelected;

		// With a cleared selection nothing may keep the highlight: `is-focused`
		// draws the accent outline, so it has to follow the selection too.
		const hasSelection = this.selection !== null;
		const nextFocused = hasSelection
			? (this.cellByKey.get(`${this.focus.row}:${this.focus.col}`) ?? null)
			: null;
		if (this.paintedFocused !== nextFocused) {
			this.paintedFocused?.classList.remove("is-focused");
			nextFocused?.classList.add("is-focused");
			this.paintedFocused = nextFocused;
		}
		// Scrolling into view is only meaningful while something is selected;
		// otherwise a click elsewhere in the note would yank the grid back.
		nextFocused?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}

	// ── Editing ────────────────────────────────────────────────────────────

	private startEdit(row: number, col: number): void {
		if (this.editor) this.commitEdit();
		const cell = this.containerEl.querySelector<HTMLElement>(
			`.super-csv-editor-cell[data-row="${row}"][data-col="${col}"]`,
		);
		if (!cell) return;

		const value = this.table.rows[row]?.[col] ?? "";
		// The editor lives INSIDE the cell and fills it, so no separate popup
		// window ever appears over the grid.
		const editor = cell.createEl("textarea", { cls: EDITOR_CLASS });
		editor.value = value;
		editor.spellcheck = false;
		cell.classList.add("is-editing");
		this.editor = editor;
		this.editorOrigin = { row, col };
		// A fresh popover per edit: it holds the textarea it is positioned
		// against, and the previous one must not survive the cell switch.
		this.suggest?.close();
		this.suggest = new LinkSuggestPopover(this.app, (next, caret) => {
			editor.value = next;
			editor.setSelectionRange(caret, caret);
			// Keep the table in step so a commit writes the linked text even if
			// the user never fires another input event.
			editor.dispatchEvent(new Event("input"));
		});

		// Keys bind to the transient textarea itself, so no global key listener
		// is left behind when the editor is torn down.
		editor.addEventListener("keydown", (event) => {
			event.stopPropagation();
			// The suggestion list owns the arrows/Tab/Enter while it is open, so
			// those keys pick a note instead of moving the cell selection.
			if (this.suggest?.isOpen) {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					this.suggest.move(event.key === "ArrowDown" ? 1 : -1);
					return;
				}
				if (event.key === "Enter" || event.key === "Tab") {
					event.preventDefault();
					this.suggest.accept(editor);
					return;
				}
				if (event.key === "Escape") {
					event.preventDefault();
					this.suggest.close();
					return;
				}
			}
			if (event.key === "Escape") {
				event.preventDefault();
				this.cancelEdit();
			} else if (event.key === "Enter") {
				// Shift+Enter means "carry on downwards": on the last row it
				// appends a new one rather than stopping there.
				event.preventDefault();
				if (event.ctrlKey || event.metaKey) this.commitEdit();
				else if (event.shiftKey) this.commitEditDown();
				else this.commitEdit(nextFocus({ row, col }, this.size(), "down"));
			} else if (event.key === "Tab") {
				event.preventDefault();
				this.commitEdit(
					nextFocus({ row, col }, this.size(), event.shiftKey ? "prev" : "next"),
				);
			}
		});
		// Typing `[[` opens the note list; anything else keeps it in step with
		// the text, and it closes itself once the brackets are gone.
		editor.addEventListener("input", () => this.suggest?.update(editor));
		// Clicking away from the cell commits the value, like a spreadsheet
		// auto-saving the cell you just typed in. Only Escape cancels.
		//
		// The grid must NOT grab focus back here: if the click is heading for
		// another note, tab or link, that is where focus has to end up. It only
		// reclaims focus when the blur left it nowhere (see `reclaimFocusIfIdle`).
		editor.addEventListener("blur", () => {
			this.suggest?.close();
			this.commitEdit(undefined, false);
			this.reclaimFocusIfIdle();
		});

		editor.focus();
		editor.setSelectionRange(value.length, value.length);
		// A host can reclaim focus on the same tick (the note editor in an
		// embed); without a retry the cell looks open but every keystroke goes
		// elsewhere. Only re-focus while this exact editor is still the one
		// being edited, so a fast click onto another cell is never undone.
		window.setTimeout(() => {
			if (this.editor === editor && document.activeElement !== editor) {
				editor.focus();
				editor.setSelectionRange(editor.value.length, editor.value.length);
			}
		}, 0);
	}

	private commitEdit(focusAfter?: Focus, reclaimFocus = true): void {
		const editor = this.editor;
		const origin = this.editorOrigin;
		if (!editor || !origin) return;
		this.editor = null;
		this.editorOrigin = null;
		this.suggest?.close();
		this.suggest = null;

		const value = editor.value;
		const oldValue = this.table.rows[origin.row]?.[origin.col] ?? "";
		const changed = oldValue !== value;
		const autoFit = this.host.getColumnWidthLimits?.()?.autoFit ?? true;
		const oldWidest =
			changed && autoFit ? widestTextInColumn(this.table, origin.col) : "";
		if (changed) {
			this.recordUndo();
			this.table = setCell(this.table, origin.row, origin.col, value);
			this.dirty = true;
			const cell = this.cellByKey.get(`${origin.row}:${origin.col}`);
			if (cell) {
				cell.classList.toggle("is-empty", value === "");
				this.renderCell(cell, value);
			}
			this.host.onChange();
			this.updateStatus();
		}

		editor.parentElement?.classList.remove("is-editing");
		editor.remove();
		if (reclaimFocus) this.containerEl.focus();
		const widthChanged =
			changed &&
			autoFit &&
			widestTextInColumn(this.table, origin.col) !== oldWidest;
		const needsRebuild = this.refreshPending || widthChanged;
		this.refreshPending = false;
		if (needsRebuild) {
			this.render(this.showStatus);
		} else if (changed && this.filterQuery.trim() !== "") {
			// Update only the edited row's filter visibility without rebuilding the table.
			this.recomputeFilter();
			this.rowEls[origin.row]?.classList.toggle(
				"is-filtered-out",
				this.hiddenRows.has(origin.row),
			);
		}
		if (focusAfter) this.setFocus(focusAfter);
		else this.paint();
	}

	/**
	 * Claims the keyboard back for the grid only when the blur left focus
	 * nowhere.
	 *
	 * A blur caused by clicking another note, tab, pane or link must land there;
	 * a blur caused by clicking dead space leaves `activeElement` on `<body>`,
	 * and the grid has to take it back or Enter stops reopening the cell editor.
	 * The decision is deferred one tick because the element taking focus is only
	 * knowable once the browser has finished the focus change.
	 */
	private reclaimFocusIfIdle(): void {
		window.setTimeout(() => {
			// A new cell editor already owns the focus; leave it alone.
			if (this.editor !== null) return;
			const active = document.activeElement;
			if (active === null || active === document.body) this.containerEl.focus();
		}, 0);
	}

	private commitEditDown(): void {
		const origin = this.editorOrigin;
		if (!origin) {
			this.commitEdit();
			return;
		}
		const last = this.table.rows.length - 1;
		// Only the very last row grows the table; anywhere else Shift+Enter is
		// just Enter with a different key held down, so it walks down as usual.
		if (origin.row >= last) {
			const col = origin.col;
			this.commitEdit();
			// addRow() re-renders, so the new cell is on screen and can be
			// focused; opening the editor at once means the user can keep typing
			// the next line without a second keystroke.
			this.addRow();
			this.startEdit(last + 1, col);
			return;
		}
		this.commitEdit(nextFocus(origin, this.size(), "down"));
	}

	private cancelEdit(): void {
		const editor = this.editor;
		if (!editor) return;
		this.editor = null;
		this.editorOrigin = null;
		this.suggest?.close();
		this.suggest = null;
		editor.parentElement?.classList.remove("is-editing");
		editor.remove();
		// Same reason as commitEdit: Escape must not cost the grid its focus.
		this.containerEl.focus();
		if (this.refreshPending) {
			this.refreshPending = false;
			this.refresh();
			return;
		}
		this.paint();
	}

	// ── Structure edits ────────────────────────────────────────────────────

	/** Snapshots the current table so undo can step back to it. */
	private recordUndo(): void {
		this.undoStack.push(this.snapshotTable());
		if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
		this.redoStack = [];
	}

	/** A deep copy of every field, including the per-row width/blank bookkeeping. */
	private snapshotTable(): CsvTable {
		// This used to copy only headers/rows/raggedRows, dropping rowWidths and
		// blankRows. After an undo the table then had no width bookkeeping, so a
		// short row was rewritten at full width (extra delimiters) and a blank
		// line collapsed into ",," — the exact round-trip bug the parser exists
		// to avoid. Sharing `clone` keeps the two definitions from drifting.
		return clone(this.table);
	}

	undo(): void {
		const previous = this.undoStack.pop();
		if (!previous) {
			this.flashStatus("Nothing to undo");
			return;
		}
		this.redoStack.push(this.snapshotTable());
		this.table = previous;
		this.dirty = this.getViewData() !== this.original;
		this.render(this.showStatus);
		this.host.onChange();
	}

	redo(): void {
		const next = this.redoStack.pop();
		if (!next) {
			this.flashStatus("Nothing to redo");
			return;
		}
		this.undoStack.push(this.snapshotTable());
		this.table = next;
		this.dirty = this.getViewData() !== this.original;
		this.render(this.showStatus);
		this.host.onChange();
	}

	private mutate(fn: (t: CsvTable) => CsvTable, focus?: Focus): void {
		this.recordUndo();
		this.table = fn(this.table);
		this.dirty = true;
		// this.showStatus, not the parameter: mutate() is the re-render path
		// for every edit, and an embed must not regain its status bar the
		// first time a cell is edited.
		this.render(this.showStatus);
		if (focus) this.setFocus(focus);
		this.host.onChange();
	}

	// ── Rendering ──────────────────────────────────────────────────────────

	/**
	 * `showStatus` is false for an embed: the row/column/delimiter readout is
	 * workspace chrome that makes no sense inside a note. The bar is still
	 * created when status is needed for `flashStatus`, so warnings appear.
	 */
	private render(showStatus: boolean): void {
		const container = this.containerEl;
		// `render()` throws the whole grid away and builds a new one, so the
		// scroll box is a NEW element and its scrollLeft starts at 0. Anything
		// that refreshes while the user is looking at the right-hand columns
		// therefore yanks the view back to the first column.
		//
		// That is not hypothetical: the wikilink repaint is wired to
		// metadataCache "resolved", which fires whenever Obsidian rebuilds its
		// link index (any file added, removed or renamed), with no regard for
		// what the user is doing. Dragging the horizontal scrollbar while that
		// lands mid-drag was the reported bug. Carrying the offset across the
		// rebuild keeps the view where the user put it.
		const prevScroll = container.querySelector<HTMLElement>(
			".super-csv-editor-scroll",
		);
		const keepScrollLeft = prevScroll?.scrollLeft ?? 0;
	const keepScrollTop = prevScroll?.scrollTop ?? 0;
		// The hidden set is derived from the table and the query, and the table
		// changes on every edit, so it is recomputed here rather than only when
		// the query changes — a cell edited to (or away from) a match has to
		// move in or out of the filter immediately.
		// Disconnect observers and scroll listeners from the previous DOM before
		// emptying it, so detached nodes are never retained in memory (even when
		// showAddButtons is false).
		this.addColObserver?.disconnect();
		this.addColObserver = null;
		this.repinAddColumn = null;
		this.addRowObserver?.disconnect();
		this.addRowObserver = null;
		this.detachAddRowScroll?.();
		this.detachAddRowScroll = null;
		this.detachAddColScroll?.();
		this.detachAddColScroll = null;

		this.recomputeFilter();
		container.empty();
		container.addClass("super-csv-editor-container");
		this.rowEls = [];
		this.cellByKey.clear();
		this.paintedSelected.clear();
		this.paintedFocused = null;
		this.editor = null;
		this.editorOrigin = null;
		// render() rebuilds the whole grid, so any open editor (and its popover)
		// is destroyed here; the popover lives outside the container.
		this.suggest?.close();
		this.suggest = null;

		const cols = columnCount(this.table);
		const visible = this.visibleRows();

		// A real <table> keeps every column aligned on its own, which a stack of
		// per-row CSS grids cannot do. table-layout: fixed then makes each column
		// share one width for the header and all rows.
		const scroll = container.createDiv({ cls: "super-csv-editor-scroll" });
		// The wrapper is the positioning context for the add-column strip and
		// shrink-wraps the table, so the strip is exactly as tall as the grid.
		const wrap = scroll.createDiv({ cls: "super-csv-editor-grid-wrap" });
		const table = wrap.createEl("table", { cls: "super-csv-editor-grid" });

		// Widths live on <col>, not on the cells, so every row honours them and
		// the header cannot drift away from the data below it.
		this.applyWidths(table, cols);

		const thead = table.createEl("thead");
		const headRow = thead.createEl("tr", { cls: "super-csv-editor-row is-header" });
		// The gutter numbers every row the way the file is laid out: the header is
		// row 0 and the first data row is 1, so the numbers and the column labels
		// agree on which line a cell came from. The cell must exist even when
		// empty, or the header row would be one cell short and every column would
		// sit under the wrong band.
		headRow.createEl("th", {
			cls: "super-csv-editor-cell is-gutter-cell is-header-cell",
			text: "0",
		});
		for (let col = 0; col < cols; col++) {
			const cell = headRow.createEl("th", {
				cls: "super-csv-editor-cell is-header-cell",
				attr: { "data-col": String(col) },
			});
			cell.setText(stripInvisible(this.table.headers[col] ?? ""));
			// The header doubles as the rename affordance, so it keeps its own
			// double-click; the resize handle stops it from ever reaching it.
			cell.addEventListener("dblclick", () => this.promptRenameColumn(col));
			cell.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.showColumnMenu(event, col);
			});
			// A click on the column header (not a drag, not the resize handle)
			// selects the whole column. addColumnDrag already tracks whether a
			// real drag happened; the resize handle stops propagation so it
			// never reaches here. Shift extends to a block of columns.
			cell.addEventListener("mouseup", (event) => {
				if (event.button !== 0) return;
				if (this.wasColumnDragged) {
					this.wasColumnDragged = false;
					return;
				}
				// Keep the grid focused so arrows work right after the click,
				// e.g. selecting a column and pressing Left/Right.
				this.containerEl.focus();
				if (event.shiftKey && this.selection !== null) {
					// The anchor lands on the first cell of the column, not the
					// last: the focus cell scrolls into view, so anchoring at the
					// bottom row scrolled a tall sheet down every time.
					this.setFocus({ row: 0, col }, true, false);
					return;
				}
				this.selectColumn(col, event.ctrlKey || event.metaKey);
			});
			this.addResizeHandle(cell, col);
			this.addColumnDrag(cell, col);
		}

		// The ghost slot the "+" is drawn in. It needs a cell in every row: table
		// cells map onto columns left to right, so a missing cell would shift
		// everything after it onto the wrong band.
		const ghostCell = headRow.createEl("th", { cls: "super-csv-editor-cell is-ghost-col" });
		// The slack filler only belongs to the full view. It exists to stop the
		// leftover width being shared out between the real columns (which
		// stretched the gutter), and it does that by claiming all the space —
		// which is exactly what stops an embed from shrink-wrapping around its
		// table. An embed therefore omits it and lets the table size to its
		// columns, so the box ends at the last column instead of running to the
		// edge of the note.
		if (this.fillSlack) {
			headRow.createEl("th", { cls: "super-csv-editor-cell is-spacer" });
		}

		const tbody = table.createEl("tbody");
		this.wireBody(tbody);
		const raggedSet = new Set(this.table.raggedRows);
		for (let row = 0; row < visible; row++) {
			const isRagged = raggedSet.has(row);
			const rowEl = tbody.createEl("tr", {
				cls: isRagged ? "super-csv-editor-row is-ragged" : "super-csv-editor-row",
				attr: { "data-row": String(row) },
			});
			this.rowEls.push(rowEl);
			// A row the search does not match is hidden by CSS, not dropped: the
			// cells keep their data-row so editing, selection and the clipboard
			// still address the real file lines underneath.
			if (this.hiddenRows.has(row)) rowEl.addClass("is-filtered-out");
			// The row number, as the first cell. It is display-only: it carries no
			// data-row/data-col, so selection, editing and the clipboard all skip
			// it, and it can never be written back to the CSV. Right-click opens
			// a row-scoped menu so the number acts as a row handle.
			rowEl.createEl("td", {
				cls: "super-csv-editor-cell is-gutter-cell",
				text: String(row + 1),
			});
			for (let col = 0; col < cols; col++) {
				const value = this.table.rows[row]?.[col] ?? "";
				const cell = rowEl.createEl("td", {
					cls: `super-csv-editor-cell${value === "" ? " is-empty" : ""}`,
					attr: { "data-row": String(row), "data-col": String(col) },
				});
				this.renderCell(cell, value);
				this.cellByKey.set(`${row}:${col}`, cell);
			}
			// The ghost slot (where the "+" is drawn) and, in the full view, the
			// slack filler that closes the row. Neither carries
			// data-row/data-col, so selection, editing and the clipboard skip
			// them and they can never be written back to the CSV.
			rowEl.createEl("td", { cls: "super-csv-editor-cell is-ghost-col" });
			if (this.fillSlack) {
				rowEl.createEl("td", { cls: "super-csv-editor-cell is-spacer" });
			}
		}

		// "+ New row" sits at the END OF THE TABLE, inside the wrapper and
		// immediately after it, so it hugs the last row and scrolls with the
		// grid. On the container it became a footer: the scroll box takes
		// `flex: 1 1 auto`, so on a short file it stretched and left the bar
		// stranded at the bottom of the pane (measured: 219px of dead space
		// below the last row), and on a long file it floated over rows it did
		// not belong to.
		//
		// It must NOT be `width: 100%` inside the wrapper: the wrapper
		// shrink-wraps the table, so 100% there is the whole grid width
		// (measured: 894px inside a 700px text column) and pushed the bar
		// off-screen. It is a block under the table instead, clamped to the
		// visible width so a wide grid cannot stretch it.
		// An embed can hide both strips; the context menus still insert rows
		// and columns, so nothing becomes unreachable.
		if (this.showAddButtons) {
			const addRowBar = wrap.createDiv({ cls: "super-csv-editor-add-row" });
			addRowBar.setText("+ new row");
			addRowBar.setAttribute("aria-label", "Add row");
			addRowBar.setAttribute("role", "button");
			addRowBar.addEventListener("click", () => this.addRowAtEnd());
			this.anchorAddRow(addRowBar);
		}

		// "+ new column" reads vertically in the ghost slot, so the control is
		// labelled the same way "+ new row" is instead of being a bare "+" whose
		// meaning the user has to infer. It must be ONE text node: splitting it
		// into spans so each character rotates independently renders every glyph
		// sideways, which is illegible.
		if (this.showAddButtons) {
			const addColBar = wrap.createDiv({ cls: "super-csv-editor-add-col" });
			addColBar.setText("+ new column");
			addColBar.setAttribute("aria-label", "Add column");
			addColBar.setAttribute("role", "button");
			addColBar.addEventListener("click", () => this.addColumnAtEnd());
			this.anchorAddColumn(ghostCell, addColBar);
		}

		this.statusEl = showStatus
			? container.createDiv({ cls: "super-csv-editor-status" })
			: null;
		this.paint();
		this.updateStatus();
		// Put the horizontal scroll back where the user had it. Assigned as a
		// plain property, NOT `scrollTo`: measured in Chromium, `scrollTo` on an
		// element that has not been laid out yet is silently dropped (result 0),
		// while setting `scrollLeft` sticks across the next layout pass.
		if (keepScrollLeft > 0 || keepScrollTop > 0) {
			const restored = this.containerEl.querySelector<HTMLElement>(
				".super-csv-editor-scroll",
			);
			if (restored) {
				restored.scrollLeft = keepScrollLeft;
				restored.scrollTop = keepScrollTop;
			}
		}
	}

	/**
	 * Delegates cell and row-gutter pointer events at the `<tbody>` level so a
	 * 1,000-row sheet registers 4 listeners instead of tens of thousands of
	 * per-cell closures.
	 */
	private wireBody(tbody: HTMLElement): void {
		tbody.addEventListener("mousedown", (event) => {
			if (event.button !== 0) return;
			const target = event.target as HTMLElement | null;
			if (!target || target.closest(EDITOR_SELECTOR)) return;
			if (target.closest(".super-csv-editor-checkbox")) return;

			const gutter = target.closest<HTMLElement>(
				".super-csv-editor-cell.is-gutter-cell",
			);
			if (gutter) {
				const row = Number(gutter.parentElement?.dataset.row);
				if (!Number.isFinite(row)) return;
				event.preventDefault();
				event.stopPropagation();
				this.containerEl.focus();
				if (event.shiftKey && this.selection !== null) {
					this.setFocus({ row, col: 0 }, true, false);
					return;
				}
				this.selectRow(row, event.ctrlKey || event.metaKey);
				return;
			}

			const cell = target.closest<HTMLElement>(
				".super-csv-editor-cell[data-row][data-col]",
			);
			if (!cell) return;
			const row = Number(cell.dataset.row);
			const col = Number(cell.dataset.col);
			if (!Number.isFinite(row) || !Number.isFinite(col)) return;
			event.preventDefault();
			this.setFocus({ row, col }, event.shiftKey, event.ctrlKey || event.metaKey);
			this.containerEl.focus();
			this.dragging = true;
		});

		tbody.addEventListener("mouseover", (event) => {
			if (!this.dragging || event.buttons !== 1) return;
			const target = event.target as HTMLElement | null;
			const cell = target?.closest<HTMLElement>(
				".super-csv-editor-cell[data-row][data-col]",
			);
			if (!cell) return;
			const row = Number(cell.dataset.row);
			const col = Number(cell.dataset.col);
			if (!Number.isFinite(row) || !Number.isFinite(col)) return;
			if (row === this.focus.row && col === this.focus.col) return;
			this.setFocus({ row, col }, true, false);
		});

		tbody.addEventListener("dblclick", (event) => {
			const target = event.target as HTMLElement | null;
			if (!target || target.closest(EDITOR_SELECTOR)) return;
			const cell = target.closest<HTMLElement>(
				".super-csv-editor-cell[data-row][data-col]",
			);
			if (!cell) return;
			const row = Number(cell.dataset.row);
			const col = Number(cell.dataset.col);
			if (!Number.isFinite(row) || !Number.isFinite(col)) return;
			this.startEdit(row, col);
		});

		tbody.addEventListener("contextmenu", (event) => {
			const target = event.target as HTMLElement | null;
			if (!target) return;
			const gutter = target.closest<HTMLElement>(
				".super-csv-editor-cell.is-gutter-cell",
			);
			if (gutter) {
				const row = Number(gutter.parentElement?.dataset.row);
				if (!Number.isFinite(row)) return;
				event.preventDefault();
				this.focus = { ...this.focus, row };
				this.showRowMenu(event, row);
				return;
			}
			const cell = target.closest<HTMLElement>(
				".super-csv-editor-cell[data-row][data-col]",
			);
			if (!cell) return;
			const row = Number(cell.dataset.row);
			const col = Number(cell.dataset.col);
			if (!Number.isFinite(row) || !Number.isFinite(col)) return;
			event.preventDefault();
			if (!isSelected(this.selection, { row, col }, this.hiddenRows)) {
				this.setFocus({ row, col });
			}
			this.showCellMenu(event);
		});

		// Delegated link clicks (external URLs + wikilinks) and boolean checkbox toggles.
		tbody.addEventListener("click", (event) => {
			const target = event.target as HTMLElement | null;
			if (!target) return;
			const extLink = target.closest<HTMLAnchorElement>("a.super-csv-editor-link");
			if (extLink) {
				event.preventDefault();
				event.stopPropagation();
				const url = extLink.getAttribute("href");
				if (url) this.openExternalUrl(url);
				return;
			}
			const wikiLink = target.closest<HTMLAnchorElement>("a.super-csv-editor-wikilink");
			if (wikiLink) {
				event.preventDefault();
				event.stopPropagation();
				if (event.ctrlKey || event.metaKey) {
					const linkTarget = wikiLink.dataset.target;
					if (linkTarget) {
						this.openWikilink(
							linkTarget,
							wikiLink.dataset.heading,
							wikiLink.dataset.blockId,
						);
					}
				}
			}
		});

		tbody.addEventListener("change", (event) => {
			const target = event.target as HTMLElement | null;
			if (!target?.classList.contains("super-csv-editor-checkbox")) return;
			const checkbox = target as HTMLInputElement;
			const cell = checkbox.closest<HTMLElement>(
				".super-csv-editor-cell[data-row][data-col]",
			);
			if (!cell) return;
			const row = Number(cell.dataset.row);
			const col = Number(cell.dataset.col);
			const next = checkbox.checked ? "true" : "false";
			if (!Number.isFinite(row) || !Number.isFinite(col)) return;
			if ((this.table.rows[row]?.[col] ?? "") === next) return;
			this.recordUndo();
			this.table = setCell(this.table, row, col, next);
			this.dirty = true;
			this.host.onChange();
			this.updateStatus();
		});
	}

	// ── Context menu ───────────────────────────────────────────────────────

	private showCellMenu(event: MouseEvent): void {
		const cells = this.getSelectedCells();
		const one = cells.length === 1;
		const label = one ? "cell" : `${cells.length} cells`;

		// If the right-click landed on a link, offer to copy that link first.
		const target = event.target as HTMLElement | null;
		const linkEl = target?.closest?.("a") as HTMLElement | null;
		const linkTarget =
			linkEl?.dataset?.target ??
			(linkEl?.getAttribute("href") ?? "");
		const hasLink = !!linkTarget && linkTarget !== "#";

		const rowCount = new Set(cells.map((c) => c.row)).size;
		const colCount = new Set(cells.map((c) => c.col)).size;
		const rowLabel = rowCount > 1 ? `Delete ${rowCount} rows` : "Delete row";
		const colLabel = colCount > 1 ? `Delete ${colCount} columns` : "Delete column";

		const menu = new Menu();
		if (hasLink) {
			menu.addItem((item) =>
				item
					.setTitle("Copy link")
					.setIcon("copy")
					.onClick(() => void this.writeClipboard(linkTarget)),
			);
			menu.addSeparator();
		}
		menu.addItem((item) =>
			item
				.setTitle(`Copy ${label}`)
				.setIcon("copy")
				.onClick(() => this.copySelection()),
		);
		menu.addItem((item) =>
			item
				.setTitle(`Cut ${label}`)
				.setIcon("scissors")
				.onClick(() => this.cutSelection()),
		);
		menu.addItem((item) =>
			item
				.setTitle(one ? "Paste into cell" : `Paste into ${label}`)
				.setIcon("clipboard-paste")
				.onClick(() => void this.pasteIntoSelection()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(one ? "Clear cell" : `Clear ${cells.length} cells`)
				.setIcon("eraser")
				.onClick(() => this.clearSelection()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Undo")
				.setIcon("undo")
				.onClick(() => this.undo()),
		);
		menu.addItem((item) =>
			item
				.setTitle("Redo")
				.setIcon("redo")
				.onClick(() => this.redo()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle("Insert row above").setIcon("plus").onClick(() => this.addRowAbove()),
		);
		menu.addItem((item) =>
			item.setTitle("Insert row below").setIcon("plus").onClick(() => this.addRow()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Insert column left")
				.setIcon("plus")
				.onClick(() => this.insertColumnLeft(this.focus.col)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Insert column right")
				.setIcon("plus")
				.onClick(() => this.insertColumnRight(this.focus.col)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle("Move row up").setIcon("arrow-up").onClick(() => this.moveRowUp()),
		);
		menu.addItem((item) =>
			item.setTitle("Move row down").setIcon("arrow-down").onClick(() => this.moveRowDown()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle(rowLabel).setIcon("trash").onClick(() => this.removeRow()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle(colLabel).setIcon("trash").onClick(() => this.removeColumn()),
		);

		menu.showAtMouseEvent(event);
	}

	private showRowMenu(event: MouseEvent, row: number): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Move row up")
				.setIcon("arrow-up")
				.setDisabled(row === 0)
				.onClick(() => {
					this.focus = { ...this.focus, row };
					this.moveRowUp();
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle("Move row down")
				.setIcon("arrow-down")
				.setDisabled(row >= this.table.rows.length - 1)
				.onClick(() => {
					this.focus = { ...this.focus, row };
					this.moveRowDown();
				}),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle("Insert row above").setIcon("plus").onClick(() => {
				this.focus = { ...this.focus, row };
				this.addRowAbove();
			}),
		);
		menu.addItem((item) =>
			item.setTitle("Insert row below").setIcon("plus").onClick(() => {
				this.focus = { ...this.focus, row };
				this.addRow();
			}),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle("Delete row").setIcon("trash").onClick(() => {
				// Right-clicking a row number means "this row", so the delete
				// targets it whether or not anything was selected. Without the
				// selection the multi-row path would have nothing to work from.
				const selectedRows = new Set(this.getSelectedCells().map((c) => c.row));
				if (!selectedRows.has(row)) this.selectRow(row);
				this.removeRow();
			}),
		);
		menu.showAtMouseEvent(event);
	}

	private showColumnMenu(event: MouseEvent, col: number): void {
		const menu = new Menu();
		const last = columnCount(this.table) - 1;
		menu.addItem((item) =>
			item
				.setTitle("Move column left")
				.setIcon("arrow-left")
				// Nothing to its left: the menu item is shown but inert, which keeps
				// the menu the same length instead of items appearing and vanishing.
				.setDisabled(col === 0)
				.onClick(() => this.moveColumnLive(col, col - 1)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Move column right")
				.setIcon("arrow-right")
				.setDisabled(col === last)
				.onClick(() => this.moveColumnLive(col, col + 1)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Insert column left")
				.setIcon("arrow-left")
				.onClick(() => this.insertColumnLeft(col)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Insert column right")
				.setIcon("arrow-right")
				.onClick(() => this.insertColumnRight(col)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Sort ascending")
				.setIcon("arrow-up")
				.onClick(() => this.sortBy(col, "asc")),
		);
		menu.addItem((item) =>
			item
				.setTitle("Sort descending")
				.setIcon("arrow-down")
				.onClick(() => this.sortBy(col, "desc")),
		);
		if (this.host.onSearchColumn) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle("Search on this column")
					.setIcon("search")
					.onClick(() => this.host.onSearchColumn?.(col)),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Rename column")
				.setIcon("pencil")
				.onClick(() => this.promptRenameColumn(col)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Delete column")
				.setIcon("trash")
				.onClick(() => {
					// Same rule as the row menu: right-clicking a header means
					// "this column", so select it when nothing else is selected.
					const selectedCols = new Set(this.getSelectedCells().map((c) => c.col));
					if (!selectedCols.has(col)) this.selectColumn(col);
					this.removeColumn();
				}),
		);
		menu.showAtMouseEvent(event);
	}

	private sortBy(col: number, direction: "asc" | "desc"): void {
		this.mutate((t) => sortRows(t, col, direction), this.focus);
		this.flashStatus(`Sorted ${direction === "asc" ? "A\u2192Z" : "Z\u2192A"}`);
	}

	// ── Clipboard actions ──────────────────────────────────────────────────

	private async writeClipboard(text: string): Promise<void> {
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// Clipboard access can be refused; the status line says what happened.
			this.flashStatus("Clipboard write blocked");
		}
	}

	private flashStatus(message: string): void {
		if (!this.statusEl) {
			// An embed has no status bar to flash into; the warning still has to
			// reach the user somehow.
			new Notice(message);
			return;
		}
		this.statusEl.setText(message);
		if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
		this.flashTimer = window.setTimeout(() => {
			this.flashTimer = null;
			this.updateStatus();
		}, 1200);
	}

	private copySelection(): void {
		const cells = this.getSelectedCells();
		// A cleared selection must not put an empty string on the clipboard,
		// clobbering whatever the user had copied elsewhere.
		if (cells.length === 0) return;
		void this.writeClipboard(copyToClipboard(this.table, cells, this.hiddenRows));
	}

	private cutSelection(): void {
		const cells = this.getSelectedCells();
		if (cells.length === 0) return;
		const { copied, table } = cutToClipboard(this.table, cells, this.hiddenRows);
		void this.writeClipboard(copied);
		this.recordUndo();
		this.table = table;
		this.dirty = true;
		const keepScroll = this.containerEl.querySelector<HTMLElement>(
			".super-csv-editor-scroll",
		);
		const keepScrollTop = keepScroll?.scrollTop ?? 0;
		const keepScrollLeft = keepScroll?.scrollLeft ?? 0;
		this.render(this.showStatus);
		this.setFocus(this.focus);
		const restoredScroll = this.containerEl.querySelector<HTMLElement>(
			".super-csv-editor-scroll",
		);
		if (restoredScroll) {
			restoredScroll.scrollTop = keepScrollTop;
			restoredScroll.scrollLeft = keepScrollLeft;
		}
		this.host.onChange();
	}

	/**
	 * A mousedown anywhere outside the grid clears the selection.
	 *
	 * Two cases must NOT clear it:
	 *  - the click landed inside this grid (a cell handles its own focus),
	 *  - the click landed in an Obsidian overlay (menu, modal, suggestion
	 *    list), where the very next click may return to the grid. Clearing
	 *    there would wipe the selection the user is about to act on.
	 */
	private onOutsidePointer(event: MouseEvent): void {
		if (this.editor) return; // an open cell is being edited, not selected
		const target = event.target as Node | null;
		if (!target) return;
		if (this.containerEl.contains(target)) return;
		if (isObsidianOverlay(target)) return;
		this.deselect();
	}

	/**
	 * Drops the selection without touching the data.
	 *
	 * Wired to clicks outside the grid, so clicking away in the note (or
	 * anywhere else in the workspace) leaves no cell highlighted. The focus
	 * anchor is kept so arrow keys still work from the same cell.
	 */
	deselect(): void {
		if (this.selection === null) return;
		this.selection = clearedSelection();
		this.paint();
		this.updateStatus();
	}

	replaceAll(
		search: string,
		replacement: string,
		column: number | null = null,
	): number {
	if (!search) return 0;
	const pattern = new RegExp(
		search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		"g",
	);
	let count = 0;
	this.recordUndo();
	const out = clone(this.table);
	for (let row = 0; row < out.rows.length; row++) {
		const cells = out.rows[row];
		if (!cells) continue;
		const startCol = column !== null ? column : 0;
		const endCol = column !== null ? Math.min(column + 1, cells.length) : cells.length;
		for (let col = startCol; col < endCol; col++) {
			const value = cells[col] ?? "";
			const matches = value.match(pattern);
			if (!matches) continue;
			count += matches.length;
			cells[col] = value.replace(pattern, replacement);
			setCellInPlace(out, row, col, cells[col] ?? "");
		}
	}
	// Headers too (only when searching across the whole sheet).
	if (column === null) {
		for (let col = 0; col < out.headers.length; col++) {
			const value = out.headers[col] ?? "";
			const matches = value.match(pattern);
			if (!matches) continue;
			count += matches.length;
			out.headers[col] = value.replace(pattern, replacement);
		}
	}
	this.table = out;
	if (count > 0) this.dirty = true;
	this.render(this.showStatus);
	this.host.onChange();
	this.updateStatus();
	return count;
}
private clearSelection(): void {
	const cells = this.getSelectedCells();
	if (cells.length === 0) return;
		this.recordUndo();
		this.table = clearCells(this.table, cells, this.hiddenRows);
		this.dirty = true;
		this.render(this.showStatus);
		this.setFocus(this.focus);
		this.host.onChange();
	}

	private async pasteIntoSelection(): Promise<void> {
		let text = "";
		try {
			text = await navigator.clipboard.readText();
		} catch {
			this.flashStatus("Clipboard read blocked");
			return;
		}
		if (!canPasteGrid(text, 0, 0)) return;
		// The grid copies as a Markdown pipe table (so a paste lands straight
		// into a note) and pastes the same format back. TSV is still accepted
		// for content copied from Excel or Google Sheets.
		const grid = isMarkdownTable(text)
			? parseMarkdownTable(text)
			: parseClipboardGrid(text);
		if (grid.length === 0) return;

		const targets = this.getSelectedCells();
		// Anchor multi-cell paste at the top-left of the visible selection (so
		// dragging top-to-bottom pastes into the selected rows, not below them).
		const origin =
			targets.length > 0
				? {
						row: Math.min(...targets.map((c) => c.row)),
						col: Math.min(...targets.map((c) => c.col)),
					}
				: this.focus;
		this.recordUndo();

		// A single-value clipboard fills EVERY selected visible cell, the way Excel
		// repeats a copied value across a multi-cell selection. A multi-cell
		// grid on the clipboard pastes from the origin, skipping hidden rows.
		if (grid.length === 1 && (grid[0]?.length ?? 0) === 1) {
			const row = grid[0];
			const value = row?.[0] ?? "";
			// No explicit selection means the focus cell alone (if visible).
			const cells =
				targets.length > 0
					? targets
					: this.hiddenRows.has(origin.row)
						? []
						: [origin];
			// Clone once for the whole paste instead of cloning per cell.
			const out = clone(this.table);
			for (const cell of cells) setCellInPlace(out, cell.row, cell.col, value);
			this.table = reindexRagged(out, out.headers.length);
		} else {
			this.table = pasteGrid(this.table, grid, origin, this.hiddenRows);
		}
		this.dirty = true;

		const keepScroll = this.containerEl.querySelector<HTMLElement>(
			".super-csv-editor-scroll",
		);
		const keepScrollTop = keepScroll?.scrollTop ?? 0;
		const keepScrollLeft = keepScroll?.scrollLeft ?? 0;

		this.render(this.showStatus);
		this.setFocus(origin);
		// Pasting rebuilds the grid, which resets its scroll box to the top.
		// Put it back where it was so the table does not jump under the user.
		const restoredScroll = this.containerEl.querySelector<HTMLElement>(
			".super-csv-editor-scroll",
		);
		if (restoredScroll) {
			restoredScroll.scrollTop = keepScrollTop;
			restoredScroll.scrollLeft = keepScrollLeft;
		}
		this.host.onChange();
		this.updateStatus();
	}

	// ── Cell rendering ─────────────────────────────────────────────────────

	/**
	 * Whether a link target points at a file that exists in the vault.
	 *
	 * `getFirstLinkpathDest` is the same resolution Obsidian's own editor uses,
	 * so `[[Note]]` here and `[[Note]]` in a note agree on their target. The
	 * decision itself lives in `linkResolution`, which knows that "no source
	 * path" means "unknown" rather than "broken".
	 */
	private resolvesToFile(target: string): boolean {
		return (
			linkResolution(target, this.host.getSourcePath(), (linkpath, source) =>
				this.app.metadataCache.getFirstLinkpathDest(linkpath, source),
			) !== "unresolved"
		);
	}

	/**
	 * Paints a cell for display only. A `[[wikilink]]` becomes a real internal
	 * link, but the CSV keeps its raw text: the link is DOM, never data, so
	 * getViewData() and the file on disk are untouched by rendering.
	 *
	 * A link whose target is not in the vault is marked unresolved, so it reads
	 * grey and dotted like it does in a note. The check is done per link and
	 * resolved from the CSV's own path, which is what decides which note a bare
	 * `[[Note]]` points at when several share the name.
	 */
	private openExternalUrl(url: string): void {
		try {
			const electron = (window as unknown as { require?: (m: string) => unknown }).require?.("electron");
			const shell = (electron as { shell?: { openExternal?: (u: string) => void } } | undefined)?.shell;
			if (shell?.openExternal) {
				shell.openExternal(url);
				return;
			}
		} catch {
			// Fall through to window.open.
		}
		window.open(url, "_blank");
	}

	private renderCell(cell: HTMLElement, value: string): void {
		if (value === "") {
			cell.textContent = "";
			return;
		}
		const lowered = value.trim().toLowerCase();
		if (lowered === "true" || lowered === "false") {
			cell.empty();
			const checkbox = cell.createEl("input", { type: "checkbox" });
			checkbox.className = "super-csv-editor-checkbox";
			checkbox.checked = lowered === "true";
			cell.classList.remove("is-empty");
			return;
		}
		// Fast path for plain cells (no wikilinks, no URLs): avoids regex
		// allocation, segment arrays, and child element creation.
		if (!value.includes("[[") && !value.includes("http")) {
			cell.textContent = formatDisplayValue(value);
			return;
		}
		cell.empty();
		const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^)\s]+)/g;
		for (const segment of splitWikilinks(value)) {
			if (segment.kind === "text") {
				const formatted = formatDisplayValue(segment.value);
				if (!formatted.includes("http")) {
					cell.appendText(formatted);
					continue;
				}
				linkPattern.lastIndex = 0;
				let cursor = 0;
				for (const match of formatted.matchAll(linkPattern)) {
					const start = match.index ?? 0;
					if (start > cursor) cell.appendText(formatted.slice(cursor, start));
					const label = match[1] ?? match[3] ?? "";
					const url = match[2] ?? match[3] ?? "";
					cell.createEl("a", {
						cls: "super-csv-editor-link",
						text: label,
						href: url,
					});
					cursor = start + (match[0]?.length ?? 0);
				}
				if (cursor < formatted.length) cell.appendText(formatted.slice(cursor));
				continue;
			}
			const link = cell.createEl("a", {
				cls: "internal-link super-csv-editor-wikilink",
				text: segment.display,
				href: "#",
			});
			// The vault lookup is what decides the colour; without it every link
			// looked identical and a typo was indistinguishable from a note.
			if (!this.resolvesToFile(segment.target)) {
				link.addClass("is-unresolved");
			}
			link.dataset.target = segment.target;
			if (segment.heading) link.dataset.heading = segment.heading;
			if (segment.blockId) link.dataset.blockId = segment.blockId;
		}
	}

	/**
	 * Follows a wikilink with an EXPLICIT view type.
	 *
	 * `openLinkText(..., newLeaf = false)` alone is not enough: with a false
	 * second argument Obsidian may resolve the link in the current leaf, and if
	 * the CSV view happens to be the one showing, the note gets opened *here* and
	 * parsed as CSV. Naming the markdown view keeps every link out of the grid.
	 */
	private openWikilink(target: string, heading?: string, blockId?: string): void {
		const sourcePath = this.host.getSourcePath();
		if (!sourcePath) return;
		const suffix = blockId ? `#^${blockId}` : heading ? `#${heading}` : "";
		const linktext = `${target}${suffix}`;
		// A csv target is legal too; let it land in a CSV view on purpose.
		const isCsv = isCsvPath(target);
		void this.app.workspace.openLinkText(linktext, sourcePath, false, {
			active: true,
			eState: { type: isCsv ? CSV_VIEW_TYPE : "markdown" },
		});
	}

	// ── Column widths ──────────────────────────────────────────────────────

	/**
	 * Auto-fit measures the real rendered width of each column's widest text with
	 * the DOM instead of estimating it from a character count. An estimate is
	 * what truncated values before: it cannot know how wide a cell truly renders,
	 * and any cap on the estimate clips the widest value outright.
	 * The text width comes from a Range over a real probe cell of the same class,
	 * and the cell's own computed padding and borders are added on top. Both are
	 * read from the browser rather than hardcoded, so this cannot drift out of
	 * step with the stylesheet. offsetWidth is NOT usable here: under
	 * table-layout: fixed a probe cell reports the whole available width instead
	 * of its content, which is what silently clipped long titles.
	 */
	private applyWidths(table: HTMLElement, cols: number): void {
		const group = table.createEl("colgroup");
		// The row-number gutter is the FIRST <col>, because its cells are the
		// first cell of every row. Without a matching <col> every data column
		// would shift one band left under table-layout: fixed.
		group.createEl("col").style.width = `${GUTTER_WIDTH_PX}px`;

		const limits = this.host.getColumnWidthLimits?.();
		const autoFit = limits?.autoFit ?? true;

		if (!autoFit) {
			for (let col = 0; col < cols; col++) {
				const manual = this.manualWidths[col];
				group.createEl("col").style.width = `${clampColumnWidth(
					manual ?? DEFAULT_COLUMN_WIDTH,
					limits,
				)}px`;
			}
		} else {
			const widest = widestTextsByColumn(this.table);
			const host = this.containerEl.createDiv({ cls: "super-csv-editor-measure" });
			const probeCell = host
				.createEl("table", { cls: "super-csv-editor-grid" })
				.createEl("tbody")
				.createEl("tr")
				.createEl("td", { cls: "super-csv-editor-cell" });
			const range = document.createRange();
			// Padding and borders are read once from the probe cell so the stylesheet
			// stays the single source of truth without recomputing style per column.
			const cs = window.getComputedStyle(probeCell);
			const chrome =
				Number.parseFloat(cs.paddingLeft) +
				Number.parseFloat(cs.paddingRight) +
				Number.parseFloat(cs.borderLeftWidth) +
				Number.parseFloat(cs.borderRightWidth);

			for (let col = 0; col < cols; col++) {
				probeCell.setText(widest[col] || " ");
				range.selectNodeContents(probeCell);
				const textWidth = range.getBoundingClientRect().width;

				// A <col> width is border-box, so the cell ends up one border short of
				// text+chrome: the neighbouring cell's border eats the last pixel. One
				// extra pixel per side clears it, which is invisible next to the
				// alternative of a clipped last character.
				const manual = this.manualWidths[col];
				const needed = Math.ceil(textWidth) + chrome + CELL_BORDER_SLACK_PX;
				group.createEl("col").style.width = `${clampColumnWidth(manual ?? needed, limits)}px`;
			}

			host.remove();
		}

		// The ghost column is a real, empty slot immediately after the last data
		// column: the "+" lives in it, so the control hugs the last column the way
		// "+ New row" hugs the last row.
		group.createEl("col").style.width = `${GHOST_COLUMN_WIDTH}px`;
		if (this.fillSlack) {
			group.createEl("col");
		}
	}

	/**
	 * Sizes "+ New row" to the grid's REAL content, ending at the ghost slot.
	 *
	 * Measuring the table's own width does not work: the slack filler absorbs
	 * every spare pixel, so the table is always as wide as the pane and the bar
	 * would still stretch past the last column (measured: last column ended at
	 * 190px while the bar ran to 820px). The end of the content is the ghost
	 * cell's right edge — the last element that is actually part of the grid —
	 * so the bar stops there and reads as the table's closing edge.
	 *
	 * `transform` carries the horizontal scroll: the bar is a sibling of the
	 * table, so in content coordinates it must be translated to follow the
	 * columns the user is looking at. Its width is capped at the visible area so
	 * a grid wider than the pane cannot push its own control out of reach.
	 */
	private anchorAddRow(bar: HTMLElement): void {
		const scrollBox = this.containerEl.querySelector<HTMLElement>(
			".super-csv-editor-scroll",
		);
		if (!scrollBox) return;
		const pin = (): void => {
			const table = this.containerEl.querySelector<HTMLElement>(
				".super-csv-editor-grid",
			);
			const ghost = this.containerEl.querySelector<HTMLElement>(
				"thead .is-ghost-col",
			);
			if (!table || !ghost) return;
			// Where the grid's content actually stops: the ghost slot's right edge,
			// taken in the WRAPPER's coordinate space so it is a content offset.
			const wrapLeft = table.getBoundingClientRect().left;
			const contentWidth = Math.max(
				ghost.getBoundingClientRect().right - wrapLeft,
				0,
			);
			// Never wider than what is on screen: on a wide grid the bar must not
			// become a control the user cannot see or click.
			const visible = scrollBox.clientWidth;
			const width = visible > 0 ? Math.min(contentWidth, visible) : contentWidth;
			bar.style.width = `${width}px`;
			// The bar sits under the table inside a scrollable parent; pinning it
			// to the scroll offset keeps it under the columns the user is
			// looking at instead of drifting with the table.
			bar.style.transform = `translateX(${scrollBox.scrollLeft}px)`;
		};
		pin();
		// Measure again after layout settles. `render()` calls this before the
		// browser has laid the new table out, so the first read can see stale or
		// zero geometry — and a ResizeObserver will NOT correct it, because
		// nothing changes SIZE afterwards (the grid is static until the user
		// acts). Without this pass the bar keeps whatever width the early read
		// produced, which is what left it spanning the pane instead of the grid.
		if (typeof window.requestAnimationFrame === "function") {
			window.requestAnimationFrame(pin);
		}
		this.addRowObserver?.disconnect();
		if (typeof ResizeObserver !== "undefined") {
			this.addRowObserver = new ResizeObserver(pin);
			this.addRowObserver.observe(scrollBox);
			// Adding, resizing or removing a column changes the ghost's position
			// WITHOUT changing the table's width, because the filler absorbs it.
			const ghost = this.containerEl.querySelector<HTMLElement>(
				"thead .is-ghost-col",
			);
			if (ghost) this.addRowObserver.observe(ghost);
		}
		this.detachAddRowScroll?.();
		scrollBox.addEventListener("scroll", pin, { passive: true });
		this.detachAddRowScroll = () => scrollBox.removeEventListener("scroll", pin);
	}

	/**
	 * Pins the "+" over the ghost column, so it sits immediately after the last
	 * data column the way "+ New row" sits immediately after the last row.
	 *
	 * Three earlier approaches are all wrong, and this is none of them:
	 *  - `right: 0` anchored the strip to the WRAPPER, a plain block whose right
	 *    edge is the pane's and not the table's, so a table wider than the pane
	 *    put the "+" over whichever column happened to be second to last.
	 *  - Clamping the table's right edge to the visible edge kept it on screen
	 *    but parked it on top of a data column whenever the grid scrolled.
	 *  - `position: sticky` looked like the answer (the browser tracks the
	 *    offset for free) but the wrapper is a plain block sized to the SCROLL
	 *    BOX, not to the table, so "right: 0" pinned the strip to the visible
	 *    edge of the pane and it never reached the ghost at all.
	 *
	 * What is left is measuring the ghost against the wrapper and re-measuring
	 * whenever the measurement can change — which includes EVERY scroll event.
	 * Measuring once was the original bug: the offset is read in content
	 * coordinates and is frozen at that instant, so scrolling moved the columns
	 * away from the strip and left it stranded off the left edge (measured at
	 * scrollLeft 250: strip at -193px, ghost at 423px).
	 */
	private anchorAddColumn(ghostCell: HTMLElement, strip: HTMLElement): void {
		const scrollBox = this.containerEl.querySelector<HTMLElement>(
			".super-csv-editor-scroll",
		);
		const pin = (): void => {
			const wrap = strip.parentElement;
			if (!wrap) return;
			// The ghost's left edge in the WRAPPER's coordinate space. Both are
			// read in the same instant, so the scroll offset cancels out and the
			// result is a content offset the strip can be absolutely positioned by.
			const left =
				ghostCell.getBoundingClientRect().left - wrap.getBoundingClientRect().left;
			strip.style.left = `${Math.max(left, 0)}px`;
		};
		this.repinAddColumn = pin;
		pin();
		// Same reason as anchorAddRow: the first read happens before the new
		// table is laid out, and nothing resizes afterwards to correct it.
		if (typeof window.requestAnimationFrame === "function") {
			window.requestAnimationFrame(pin);
		}
		this.addColObserver?.disconnect();
		if (typeof ResizeObserver !== "undefined") {
			this.addColObserver = new ResizeObserver(pin);
			this.addColObserver.observe(ghostCell);
			// A pane resize changes the TABLE's size, not the ghost's.
			const table = this.containerEl.querySelector<HTMLElement>(
				".super-csv-editor-grid",
			);
			if (table) this.addColObserver.observe(table);
		}
		// Scrolling is the one thing that moves the ghost without resizing
		// anything, so no observer above can see it. This is the listener whose
		// absence let the strip drift away from the column it belongs to.
		this.detachAddColScroll?.();
		if (scrollBox) {
			scrollBox.addEventListener("scroll", pin, { passive: true });
			this.detachAddColScroll = () => scrollBox.removeEventListener("scroll", pin);
		}
	}

	/**
	 * The `<col>` band for a data column.
	 *
	 * The FIRST `<col>` belongs to the row-number gutter, so a data column `n`
	 * is the (n + 2)th col. Every lookup goes through here, because getting this
	 * off by one silently resizes the wrong column.
	 */
	private colSelector(col: number): string {
		return `.super-csv-editor-grid colgroup col:nth-child(${col + 2})`;
	}

	private setColumnWidth(col: number, width: number): void {
		this.manualWidths = { ...this.manualWidths, [col]: width };
		const el = this.containerEl.querySelector<HTMLElement>(this.colSelector(col));
		if (el) el.style.width = `${width}px`;
		// A live drag changes the width of a column BEFORE the ghost, and the
		// slack filler absorbs the difference, so the table's total width does
		// not change and no ResizeObserver fires. Without this the "+" stays put
		// while the column under it is being dragged.
		this.repinAddColumn?.();
	}

	/**
	 * Dragging a header sideways moves that column. The pointer is released
	 * over the header it should land on; the grab cursor and a moving line
	 * show the target while the drag is live.
	 */
	private addColumnDrag(cell: HTMLElement, col: number): void {
		let startX = 0;
		let dragging = false;
		let ghost: HTMLElement | null = null;
		let indicator: HTMLElement | null = null;

		const cleanup = (): void => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp, true);
			document.body.classList.remove("super-csv-editor-col-dragging");
			ghost?.remove();
			ghost = null;
			indicator?.remove();
			indicator = null;
		};

		const onMove = (move: MouseEvent): void => {
			const dx = move.clientX - startX;
			if (!dragging) {
				if (Math.abs(dx) < 4) return;
				dragging = true;
				document.body.classList.add("super-csv-editor-col-dragging");
				ghost = cell.cloneNode(true) as HTMLElement;
				ghost.addClass("super-csv-editor-col-ghost");
				const rect = cell.getBoundingClientRect();
				const host = this.containerEl.getBoundingClientRect();
				ghost.style.width = `${rect.width}px`;
				// The container does not scroll (scrolling lives on
				// .super-csv-editor-scroll), so the ghost's position is measured
				// relative to the container itself.
				ghost.style.left = `${rect.left - host.left}px`;
				ghost.style.top = `${rect.top - host.top}px`;
				this.containerEl.appendChild(ghost);
			}
			if (ghost) {
				ghost.style.transform = `translate(${dx}px, 0)`;
			}
			if (indicator) {
				indicator.remove();
				indicator = null;
			}
			const over = document.elementFromPoint(move.clientX, move.clientY);
			const targetCell = over?.closest<HTMLElement>("th[data-col]");
			if (targetCell) {
				indicator = targetCell.createDiv({
					cls: "super-csv-editor-col-drop-indicator",
				});
			}
		};

		const onUp = (up: MouseEvent): void => {
			const over = document.elementFromPoint(up.clientX, up.clientY);
			const targetCell = over?.closest<HTMLElement>("th[data-col]");
			const toCol = targetCell ? Number(targetCell.dataset.col) : NaN;
			const wasDragging = dragging;
			cleanup();
			dragging = false;
			// Tells the header's mouseup whether a real drag happened, so a
			// reorder does not also select the column.
			this.wasColumnDragged = wasDragging;
			if (!wasDragging) return;
			if (!Number.isFinite(toCol) || toCol === col) return;
			this.moveColumnLive(col, toCol);
		};

		cell.addEventListener("mousedown", (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			startX = event.clientX;
			dragging = false;
			window.addEventListener("mousemove", onMove);
			// Capture phase on purpose: the header's own mouseup listener (bound
			// in render) runs on the bubble phase and reads `wasColumnDragged`,
			// so onUp must run FIRST to record whether this gesture moved the
			// column before the header decides whether to select it. On the
			// bubble phase the header ran before onUp, which made a drag also
			// select a column and swallowed the next header click.
			window.addEventListener("mouseup", onUp, true);
		});
	}

	/** Moves a column and re-keys manual widths together, so a manual width
	 * follows its column instead of leaking onto the column that took its place. */
	private moveColumnLive(from: number, to: number): void {
		const next: ManualWidths = {};
		const widths = this.table.headers.map((_, i) => this.manualWidths[i]);
		const [w] = widths.splice(from, 1);
		widths.splice(to, 0, w);
		widths.forEach((value, index) => {
			if (value !== undefined) next[index] = value;
		});
		this.manualWidths = next;
		this.mutate((t) => moveColumn(t, from, to), {
			row: this.focus.row,
			col: to,
		});
	}

	/**
	 * A 7px grab strip sits on the right edge of each header cell and drags the
	 * boundary. Double-clicking it resets that column back to auto-fit.
	 */
	private addResizeHandle(cell: HTMLElement, col: number): void {
		const handle = cell.createDiv({ cls: "super-csv-editor-resizer" });
		handle.setAttribute("aria-label", "Resize column");

		let startX = 0;
		let startWidth = 0;

		handle.addEventListener("mousedown", (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			const current = this.containerEl.querySelector<HTMLElement>(this.colSelector(col));
			startX = event.clientX;
			startWidth = Number.parseFloat(current?.style.width ?? "") || MIN_COLUMN_WIDTH;

			const onMove = (move: MouseEvent): void => {
				this.setColumnWidth(
					col,
					resizeWidth(
						startWidth,
						move.clientX - startX,
						this.host.getColumnWidthLimits?.(),
					),
				);
			};
			const onUp = (): void => {
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				document.body.classList.remove("super-csv-editor-resizing");
			};
			document.body.classList.add("super-csv-editor-resizing");
			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		});

		handle.addEventListener("dblclick", (event) => {
			// Reset to auto: drop the manual override and re-render the widths.
			event.stopPropagation();
			const next = { ...this.manualWidths };
			delete next[col];
			this.manualWidths = next;
			this.render(this.showStatus);
		});
	}

	// ── Keyboard on the grid ───────────────────────────────────────────────

	private onGridKeydown = (event: KeyboardEvent): void => {
		if (this.editor) return;
		if (!this.containerEl.contains(document.activeElement)) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest(EDITOR_SELECTOR)) return;

		// The grid owns the keyboard while a cell has focus, so the key must
		// not travel any higher. In a `![[file.csv]]` embed the ancestor is the
		// note's own CodeMirror editor, which ALSO handles keys: a bubbled
		// Enter split the paragraph (re-rendering the embed and throwing away
		// the cell editor that had just opened — "Enter opens the cell but I
		// can't type"), and a bubbled letter would type straight into the note.
		// Consuming keys here is harmless in the standalone view, where nothing
		// above the grid listens for them.
		event.stopPropagation();

		const ctrl = event.ctrlKey || event.metaKey;

		if ((event.key === "Delete" || event.key === "Backspace") && !event.shiftKey && !ctrl) {
			event.preventDefault();
			this.clearSelection();
			return;
		}

		if (ctrl && !event.altKey) {
			if (event.key === "z" || event.key === "Z") {
				event.preventDefault();
				if (event.shiftKey) this.redo();
				else this.undo();
				return;
			}
			if (event.key === "y" || event.key === "Y") {
				event.preventDefault();
				this.redo();
				return;
			}
		}

		if (ctrl && !event.shiftKey && !event.altKey) {
			if (event.key === "c" || event.key === "C") {
				event.preventDefault();
				this.copySelection();
				return;
			}
			if (event.key === "x" || event.key === "X") {
				event.preventDefault();
				this.cutSelection();
				return;
			}
			if (event.key === "v" || event.key === "V") {
				event.preventDefault();
				void this.pasteIntoSelection();
				return;
			}
			if (event.key === "d" || event.key === "D") {
				event.preventDefault();
				this.fillSelection("down");
				return;
			}
			if (event.key === "r" || event.key === "R") {
				event.preventDefault();
				this.fillSelection("right");
				return;
			}
			// Ctrl+A selects the whole sheet, so a single Delete can clear it.
			// Obsidian binds Ctrl+A globally, so without this it never reaches
			// the grid.
			if (event.key === "a" || event.key === "A") {
				event.preventDefault();
				this.selectAll();
				return;
			}
		}

		// Boolean cells toggle with Enter/Space instead of opening the editor.
	const focusedValue = (this.table.rows[this.focus.row]?.[this.focus.col] ?? "")
		.trim()
		.toLowerCase();
	const isBooleanCell =
		focusedValue === "true" || focusedValue === "false";
	if (isBooleanCell && (event.key === "Enter" || event.key === " ")) {
		event.preventDefault();
		const next = focusedValue === "true" ? "false" : "true";
		this.recordUndo();
		this.table = setCell(this.table, this.focus.row, this.focus.col, next);
		this.dirty = true;
		const cell = this.cellByKey.get(`${this.focus.row}:${this.focus.col}`);
		if (cell) this.renderCell(cell, next);
		this.host.onChange();
		this.updateStatus();
		return;
	}

	if (event.key === "Enter" || event.key === "F2") {
			event.preventDefault();
			// Shift+Enter walks to the row below and appends one at the bottom,
			// so filling a column downwards never dead-ends on the last row.
			if (event.key === "Enter" && event.shiftKey) {
				if (this.focus.row >= this.visibleRows() - 1) this.addRow();
				else this.setFocus(nextFocus(this.focus, this.size(), "down"), false, false);
				return;
			}
			this.editFocusedCell();
			return;
		}

		// Ctrl+Home / Ctrl+End / Ctrl+arrows jump to the corners and edges of
		// the grid; plain Home/End go to the start/end of the current row.
		// With Shift they extend the selection instead of moving the anchor.
		if (event.key === "Home" || event.key === "End" || event.key.startsWith("Arrow")) {
			const target = this.jumpTarget(event);
			if (target) {
				event.preventDefault();
				this.setFocus(target, event.shiftKey, false);
				return;
			}
		}

		const map: Record<string, Direction> = {
			ArrowUp: "up",
			ArrowDown: "down",
			ArrowLeft: "left",
			ArrowRight: "right",
			Tab: event.shiftKey ? "prev" : "next",
		};
		const direction = map[event.key];
		if (!direction) return;
		event.preventDefault();
		this.moveFocus(direction, event.shiftKey);
	};

	/**
	 * Where a navigation key should land, or null when it is a plain one-step
	 * arrow that `moveFocus` already handles.
	 *
	 * Ctrl+arrows stop at the edge of the DATA (the last non-empty cell in that
	 * direction) rather than the edge of the grid — the way Excel's Ctrl+arrow
	 * jumps to the end of a contiguous block. Empty cells are skipped when
	 * looking for the boundary, so a gap in the column stops the jump.
	 */
	private jumpTarget(event: KeyboardEvent): Focus | null {
		const ctrl = event.ctrlKey || event.metaKey;
		const { row, col } = this.focus;
		const size = this.size();
		const rows = this.table.rows;

		const lastFilledInColumn = (from: number, step: 1 | -1): number => {
			let best = from;
			for (let r = from + step; r >= 0 && r < rows.length; r += step) {
				if ((rows[r]?.[col] ?? "").trim() !== "") best = r;
				else break;
			}
			return best;
		};
		const lastFilledInRow = (from: number, step: 1 | -1): number => {
			const cells = rows[row] ?? [];
			let best = from;
			for (let c = from + step; c >= 0 && c < cells.length; c += step) {
				if ((cells[c] ?? "").trim() !== "") best = c;
				else break;
			}
			return best;
		};

		if (event.key === "Home") {
			return ctrl ? { row: 0, col: 0 } : { row, col: 0 };
		}
		if (event.key === "End") {
			return ctrl
				? { row: size.rows - 1, col: size.cols - 1 }
				: { row, col: size.cols - 1 };
		}
		if (!ctrl) return null;
		switch (event.key) {
			case "ArrowUp":
				return { row: lastFilledInColumn(row, -1), col };
			case "ArrowDown":
				return { row: lastFilledInColumn(row, 1), col };
			case "ArrowLeft":
				return { row, col: lastFilledInRow(col, -1) };
			default:
				return { row, col: lastFilledInRow(col, 1) };
		}
	}

	private updateStatus(): void {
		if (!this.statusEl) return;
		const ragged = this.table.raggedRows.length;
		const count = this.getSelectedCells().length;
		this.statusEl.setText(
			[
				`${this.table.rows.length} rows`,
				`${columnCount(this.table)} columns`,
				`delimiter "${this.delimiter === "\t" ? "tab" : this.delimiter}"`,
				ragged > 0 ? `${ragged} ragged` : "",
				count > 1 ? `${count} selected` : "",
				this.isDirty() ? "modified" : "saved",
			]
				.filter(Boolean)
				.join(" · "),
		);
	}

	private promptRenameColumn(col: number): void {
		new RenameColumnModal(this.app, this.table.headers[col] ?? "", (name) => {
			this.mutate((t) => renameColumn(t, col, name));
		}).open();
	}

	// ── Actions used by commands ───────────────────────────────────────────

	addRow(): void {
		const at = this.focus.row + 1;
		this.mutate((t) => insertRow(t, at), {
			row: Math.min(at, Math.max(this.table.rows.length - 1, 0)),
			col: this.focus.col,
		});
	}

	addRowAbove(): void {
		const at = this.focus.row;
		this.mutate((t) => insertRow(t, at), {
			row: at,
			col: this.focus.col,
		});
	}

	fillSelection(direction: "down" | "right"): void {
		const cells = this.getSelectedCells();
		if (cells.length === 0) return;
		this.mutate(
			(t) => fillSelection(t, cells, direction, this.hiddenRows),
			this.focus,
		);
	}

	/** Selects every data cell, as Ctrl+A does in a spreadsheet. */
	selectAll(): void {
		const cols = columnCount(this.table);
		const rows = this.visibleRows();
		if (cols === 0 || rows === 0) return;
		// With a filter on, "all" means the rows on screen: selecting the hidden
		// ones too would let a single Delete wipe records the user cannot see.
		const shown: number[] = [];
		for (let row = 0; row < rows; row++) {
			if (!this.hiddenRows.has(row)) shown.push(row);
		}
		if (shown.length === 0) return;
		if (shown.length !== rows) {
			const extras = shown.flatMap((row) =>
				rangeBetween({ row, col: 0 }, { row, col: cols - 1 }),
			);
			this.selection = {
				anchor: { row: shown[0] ?? 0, col: 0 },
				focus: { row: shown[0] ?? 0, col: cols - 1 },
				extras,
			};
			this.focus = { row: shown[0] ?? 0, col: 0 };
			this.paint();
			return;
		}
		this.selection = {
			anchor: { row: 0, col: 0 },
			focus: { row: rows - 1, col: cols - 1 },
			extras: [],
		};
		this.focus = { row: rows - 1, col: cols - 1 };
		this.paint();
	}

	/**
	 * Selects an entire row. Ctrl adds it to the current selection instead of
	 * replacing it, matching how a spreadsheet's row header behaves.
	 *
	 * The additive case has to add the WHOLE row as an extra band, not just its
	 * first cell. `selectedCells` expands extras one cell at a time, so adding
	 * only `{row, col: 0}` left the rest of that row unselected — and deleting
	 * the selection then removed a column-wide strip instead of the rows the
	 * user had highlighted.
	 */
	selectRow(row: number, additive = false): void {
		const cols = columnCount(this.table);
		if (cols === 0) return;
		const first = { row, col: 0 };
		const last = { row, col: cols - 1 };
		if (additive && this.selection) {
			const band = rangeBetween(first, last);
			const inBand = band.every((cell) =>
				isSelected(this.selection, cell, this.hiddenRows),
			);
			// Ctrl-clicking a row that is already fully selected removes it
			// again, the way toggling a checkbox in a list works.
			const extras = inBand
				? this.selection.extras.filter((cell) => cell.row !== row)
				: [...this.selection.extras, ...band];
			this.selection = { ...this.selection, extras };
		} else {
			this.selection = { anchor: first, focus: last, extras: [] };
		}
		// The caret (focus) goes to the FIRST cell, not the last. The focus
		// cell is the one that scrolls into view, so parking it on the last
		// column yanked the grid sideways on every row click.
		this.focus = additive ? this.focus : first;
		this.paint();
	}

	/** Selects an entire column. Ctrl adds it to the current selection. */
	selectColumn(col: number, additive = false): void {
		const rows = this.visibleRows();
		if (rows === 0) return;
		let firstRow = -1;
		let lastRow = -1;
		for (let r = 0; r < rows; r++) {
			if (this.hiddenRows.has(r)) continue;
			if (firstRow === -1) firstRow = r;
			lastRow = r;
		}
		if (firstRow === -1) return;
		const first = { row: firstRow, col };
		const last = { row: lastRow, col };
		if (additive && this.selection) {
			const band = rangeBetween(first, last).filter(
				(cell) => !this.hiddenRows.has(cell.row),
			);
			const inBand = band.every((cell) =>
				isSelected(this.selection, cell, this.hiddenRows),
			);
			const extras = inBand
				? this.selection.extras.filter((cell) => cell.col !== col)
				: [...this.selection.extras, ...band];
			this.selection = { ...this.selection, extras };
		} else {
			this.selection = { anchor: first, focus: last, extras: [] };
		}
		// Mirror of selectRow: the caret sits on the first visible cell of the
		// column so selecting a column never scrolls the grid down to the last row.
		this.focus = additive ? this.focus : first;
		this.paint();
	}

	removeRow(): void {
		const selected = this.getSelectedCells();
		const rows =
			selected.length > 0
				? [...new Set(selected.map((c) => c.row))]
				: [this.focus.row];
		if (rows.length === 0) return;
		this.mutate((t) => deleteRows(t, rows), this.focus);
	}

	addColumn(): void {
		this.mutate((t) => insertColumn(t, this.focus.col + 1, "New column"), this.focus);
	}

	/**
	 * Inserts a column at `at` and leaves focus on the new one, which is what
	 * the four insert items in the context menus share.
	 */
	private insertColumnAt(at: number): void {
		const clamped = Math.min(Math.max(at, 0), columnCount(this.table));
		this.mutate((t) => insertColumn(t, clamped, "New column"), {
			row: this.focus.row,
			col: clamped,
		});
	}

	insertColumnLeft(col: number): void {
		this.focus = { ...this.focus, col };
		this.insertColumnAt(col);
	}

	insertColumnRight(col: number): void {
		this.focus = { ...this.focus, col };
		this.insertColumnAt(col + 1);
	}

	addRowAtEnd(): void {
		const at = this.table.rows.length;
		this.mutate((t) => insertRow(t, at), { row: at, col: this.focus.col });
	}

	addColumnAtEnd(): void {
		const at = columnCount(this.table);
		this.mutate((t) => insertColumn(t, at, "New column"), { row: this.focus.row, col: at });
	}

	removeColumn(): void {
		const selected = this.getSelectedCells();
		const cols =
			selected.length > 0
				? [...new Set(selected.map((c) => c.col))]
				: [this.focus.col];
		if (cols.length === 0) return;
		this.mutate((t) => deleteColumns(t, cols), this.focus);
	}

	moveRowUp(): void {
		this.mutate((t) => moveRow(t, this.focus.row, this.focus.row - 1), this.focus);
	}

	moveRowDown(): void {
		this.mutate((t) => moveRow(t, this.focus.row, this.focus.row + 1), this.focus);
	}

	moveColumnLeft(): void {
		this.mutate((t) => moveColumn(t, this.focus.col, this.focus.col - 1), this.focus);
	}

	moveColumnRight(): void {
		this.mutate((t) => moveColumn(t, this.focus.col, this.focus.col + 1), this.focus);
	}

	editFocusedCell(): void {
		// After a click outside, the anchor is stale and no cell is selected,
		// so Enter must not silently start editing a cell the user dismissed.
		if (this.selection === null) {
			this.flashStatus("Select a cell first");
			return;
		}
		this.startEdit(this.focus.row, this.focus.col);
	}
}

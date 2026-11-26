import { Component, Notice, type TFile } from "obsidian";
import { EDITOR_SELECTOR, GridController, type EmbedLimits } from "./grid.ts";
import type SuperCsvEditorPlugin from "../main.ts";

/**
 * The embed of a `![[file.csv]]` link. Obsidian calls the factory registered
 * with `embedRegistry.registerExtension("csv", ...)` and renders whatever this
 * component mounts.
 *
 * It mounts the same `GridController` the standalone file view uses, so the
 * embed is not a preview: it has inline editing, keyboard navigation,
 * multi-selection, clipboard, undo/redo, sorting, column drag/resize and
 * clickable wikilinks, and it writes back to the CSV file. Editing it here
 * therefore behaves exactly like opening the file in its own tab.
 */
/**
 * Cancels a mousedown inside an embed, so the events never reach the
 * `![[file.csv]]` anchor Obsidian wraps it in and the hover-preview popover
 * does not open over the table.
 *
 * The cell editor is exempt. preventDefault on a mousedown inside a <textarea>
 * stops the browser placing the caret where the user clicked, which made
 * clicking a cell put the cursor at the start of the value; typing then
 * overwrote the wrong end of it.
 */
export function guardEmbedMouse(event: MouseEvent): void {
	if ((event.target as HTMLElement | null)?.closest(EDITOR_SELECTOR)) return;
	event.preventDefault();
	event.stopPropagation();
}

/**
 * Cancels selectstart for the same reason as guardEmbedMouse: a drag that
 * began inside the embed must not extend a text selection out into the
 * surrounding markdown. The editor is exempt — the user has to be able to
 * select the text they are editing.
 */
export function guardEmbedSelectStart(event: Event): void {
	if ((event.target as HTMLElement | null)?.closest(EDITOR_SELECTOR)) return;
	event.preventDefault();
}

export class CsvEmbedComponent extends Component {
	private grid: GridController | null = null;
	/** The CSV this embed renders; read by the plugin to match disk changes. */
	readonly file: TFile;
	/** Write-back is debounced per component, like the file views' save queue. */
	private saveTimer: number | null = null;

	constructor(
		private containerEl: HTMLElement,
		private plugin: SuperCsvEditorPlugin,
		file: TFile,
		/**
		 * `![[file.csv|5]]` caps the drawn rows. Obsidian delivers the alias
		 * on the container's `alt`, so the caller parses it and passes it in.
		 */
		private limits: EmbedLimits = { rowLimit: null },
	) {
		super();
		this.file = file;
	}

	override onload(): void {
		// The plugin needs to reach this embed when a settings toggle flips,
		// so it has to know which components are alive.
		this.plugin.trackEmbed(this);
		void this.loadFile();
	}

	override onunload(): void {
		this.plugin.untrackEmbed(this);
		// An embed can disappear before the debounce fires; write what is
		// pending so an edit made in the embed is never lost on re-render.
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
			void this.flush();
		}
		this.grid?.dispose();
		this.grid = null;
	}

	/**
	 * The embedRegistry contract calls `loadFile` when rendering the embed.
	 * It mirrors the built-in file-embed fallback, so this method must exist.
	 */
	async loadFile(): Promise<void> {
		try {
			const text = await this.plugin.app.vault.read(this.file);
			const grid = new GridController(this.containerEl, this.plugin.app, {
				onChange: () => this.scheduleSave(),
				getSourcePath: () => this.file.path,
				getColumnWidthLimits: () => ({
					autoFit: this.plugin.settings.autoFitColumns,
					min: this.plugin.settings.minColumnWidth,
					max: this.plugin.settings.maxColumnWidth,
				}),
			});
			grid.file = this.file;
			this.containerEl.addClass("super-csv-editor-embed");
			// Obsidian's Live Preview embed widget wires a click handler
			// (`hookClickHandler`) that SELECTS the whole embed unless an
			// ancestor of the click carries `interactive-child`. Selecting it
			// centered the note on the embed and revealed the `![[file.csv]]`
			// link, shoving the table down — the reported "click a cell and it
			// grabs the wikilink" bug. This is the same marker the built-in
			// Bases embed puts on itself, and it is what makes a custom embed
			// own its clicks the way an image embed already does.
			this.containerEl.addClass("interactive-child");
			// Obsidian renders `![[file.csv]]` embeds inside an <a> wrapper with
			// the file's own href. Events inside the grid were bubbling up to
			// that anchor: the link text got selected/highlighted and a stray
			// click could navigate. The grid handles its own input; the
			// note-level link must never see it.
			//
			// preventDefault on mousedown also stops Obsidian from opening its
			// hover-preview popover, which was the reported bug: clicking a
			// cell to edit triggered the preview widget (showing the link text
			// and pushing the table down). Cells' own mousedown listeners run
			// first — they are deeper in the tree — so selection and editing
			// are unaffected.
			this.registerDomEvent(this.containerEl, "mousedown", guardEmbedMouse);
			this.registerDomEvent(this.containerEl, "click", (event) =>
				event.stopPropagation(),
			);
			this.registerDomEvent(this.containerEl, "selectstart", guardEmbedSelectStart);
			grid.mount();
			grid.loadText(
				text,
				this.plugin.settings.delimiter,
				this.plugin.settings.embedShowStatusBar,
				this.limits.rowLimit,
				this.plugin.settings.embedShowAddButtons,
			);
			this.grid = grid;
		} catch {
			// A read failure leaves the embed empty; the user can open the file.
		}
	}

	/**
	 * Applies the embed appearance settings to an already-rendered grid, so a
	 * toggle in Settings does not need the note to be reopened.
	 */
	applySettings(options: { showAddButtons: boolean; showStatus: boolean }): void {
		const grid = this.grid;
		if (!grid) return;
		grid.applyChrome(options);
	}

	/** Redraws from the in-memory table, e.g. when column width settings changed. */
	refresh(): void {
		this.grid?.refresh();
	}

	/** Updates wikilink resolved/unresolved styling in place without rebuilding the table. */
	refreshLinks(): void {
		this.grid?.refreshLinks();
	}

	/**
	 * Pulls the file's on-disk contents into the embed's grid, because another
	 * program wrote to it. Returns false when the grid held unsaved edits.
	 */
	async reloadFromDisk(): Promise<boolean> {
		const grid = this.grid;
		if (!grid) return false;
		const text = await this.plugin.app.vault.read(this.file);
		return grid.reload(text);
	}

	/**
	 * The same debounce the file views use. An embed can be rendered many times
	 * in one note and every copy writes the same file, so one pending save per
	 * embed is enough; the writes are idempotent because each serialises the
	 * same table.
	 */
	private scheduleSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.flush();
		}, this.plugin.settings.saveDelayMs);
	}

	private async flush(): Promise<void> {
		const grid = this.grid;
		if (!grid || !grid.isDirty()) return;
		const data = grid.getViewData();
		try {
			await this.plugin.app.vault.modify(this.file, data);
		} catch (error) {
			// Same reason as the file view: a locked or offline file must not
			// lose the edit silently. The grid stays dirty, so the next edit
			// schedules another attempt.
			new Notice(
				`Could not save ${this.file.name}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return;
		}
		grid.markSaved(data);
	}
}

export interface EmbedRegistryContext {
	containerEl: HTMLElement;
}

export interface EmbedRegistry {
	isExtensionRegistered(ext: string): boolean;
	registerExtension(
		ext: string,
		factory: (context: EmbedRegistryContext, file: TFile, subPath?: string) => Component,
	): void;
	unregisterExtension(ext: string): void;
}
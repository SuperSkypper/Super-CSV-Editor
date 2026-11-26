import {
	FileView,
	Notice,
	Plugin,
	type App,
	type EventRef,
	type TAbstractFile,
	type TFile,
	TFolder,
} from "obsidian";
import { CsvView, CSV_VIEW_TYPE } from "./ui/view.ts";
import { SuperCsvSettingTab } from "./settings.ts";
import { isCsvPath, CSV_EXTENSION } from "./ui/guard.ts";
import { CsvEmbedComponent, type EmbedRegistry } from "./ui/embed.ts";
import { parseRowLimit } from "./ui/embedParams.ts";
import { NEW_CSV_CONTENT, untitledCsvPath } from "./ui/csvPath.ts";
import { MIN_COLUMN_WIDTH } from "./ui/columns.ts";

export interface SuperCsvSettings {
	/** "auto" guesses the delimiter from the file contents. */
	delimiter: string;
	saveDelayMs: number;
	/** Whether columns auto-fit to their content width (up to maxColumnWidth). */
	autoFitColumns: boolean;
	/** Minimum column width in pixels. */
	minColumnWidth: number;
	/** Maximum column width in pixels. 0 means no limit. */
	maxColumnWidth: number;
	/**
	 * Whether an embed shows the "+ New row" / "+" strips. Off makes a
	 * `![[file.csv]]` inside a note read as a plain table; the buttons
	 * remain reachable from the cell and header context menus.
	 */
	embedShowAddButtons: boolean;
	/** Whether an embed shows the rows/columns/delimiter readout. */
	embedShowStatusBar: boolean;
}

/** "add-row" → "Add row", so command names stay consistent. */
function humanize(id: string): string {
	const words = id.split("-");
	const [head, ...tail] = words;
	return `${head!.charAt(0).toUpperCase()}${head!.slice(1)} ${tail.join(" ")}`;
}

const DEFAULT_SETTINGS: SuperCsvSettings = {
	delimiter: "auto",
	saveDelayMs: 400,
	autoFitColumns: true,
	minColumnWidth: MIN_COLUMN_WIDTH,
	maxColumnWidth: 0,
	// Minimal inside a note: the readout is workspace chrome and the
	// add-row strip is a full-view affordance.
	embedShowAddButtons: false,
	embedShowStatusBar: false,
};

/**
 * `app.plugins` is not part of the public API surface, but it is the registry
 * the Settings → Community plugins screen itself drives. Obsidian exposes no
 * public equivalent for reloading a single plugin.
 */
interface PluginRegistry {
	disablePlugin(id: string): Promise<void>;
	enablePlugin(id: string): Promise<void>;
}

/**
 * `app.setting` is the Settings modal. Disabling the plugin tears its tab
 * down, and Obsidian never reopens it after `enablePlugin` — which is what
 * dropped the user out of the settings screen on restart. Reopening it is the
 * same trick the settings tab of the other Super plugins uses.
 */
interface SettingsManager {
	open?(): void;
	openTabById?(id: string): void;
}

/**
 * The options `Workspace.getRecentFiles` accepts. The method is not in the
 * public typings, but the Quick Switcher's recent list is built from it, so
 * only the members this plugin reads are declared here.
 */
interface RecentFilesOptions {
	showMarkdown?: boolean;
	showNonAttachments?: boolean;
	showNonImageAttachments?: boolean;
	showImages?: boolean;
	maxCount?: number;
}

export default class SuperCsvEditorPlugin extends Plugin {
	settings!: SuperCsvSettings;
	private pending = new Map<string, number>();
	private repaintLinksTimer: number | null = null;

	async onload(): Promise<void> {
		const loaded = (await this.loadData()) as unknown;
		this.settings = {
			...DEFAULT_SETTINGS,
			...(loaded as Partial<SuperCsvSettings> | null ?? {}),
		};
		await this.saveData(this.settings);

		this.registerView(CSV_VIEW_TYPE, (leaf) => new CsvView(leaf, this));
		this.addSettingTab(new SuperCsvSettingTab(this));

		// CSV files open in the grid rather than the raw text editor.
		this.registerExtensions(["csv"], CSV_VIEW_TYPE);
		this.patchRecentFiles();

		this.registerCommands();

		// Right-click in the file explorer: offer to create a CSV in the
		// folder that was clicked (or next to the clicked file).
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file: TAbstractFile) => {
				menu.addItem((item) => {
					item
						.setSection("action-primary")
						.setTitle("New CSV")
						.setIcon("table")
						.onClick(() => void this.createCsv(file));
				});
			}),
		);

		// Re-colour the wikilinks in every open grid when the vault's link
		// resolution changes, so a link stops being grey the moment its note is
		// created (and starts being grey the moment its note is deleted) without
		// reopening the file. This is what Obsidian does for notes; without it
		// the grid would keep showing whatever was true when it was drawn.
		// Debounced so rapid metadataCache "resolved" bursts (startup, sync,
		// bulk edits) coalesce into one pass instead of scanning resolvedLinks
		// for every open CSV on each individual note save.
		const repaintLinks = (): void => {
			if (this.repaintLinksTimer !== null) {
				window.clearTimeout(this.repaintLinksTimer);
			}
			this.repaintLinksTimer = window.setTimeout(() => {
				this.repaintLinksTimer = null;
				for (const view of this.views()) {
					view.refreshLinks();
					view.refreshLinksPanel();
				}
				for (const embed of this.liveEmbeds) embed.refreshLinks();
			}, 300);
		};
		// Both registrations are guarded: a missing event API must never take the
		// whole plugin down over what is only a cosmetic refresh. An onload that
		// throws leaves the user with no CSV editor at all.
		const cache = this.app.metadataCache as unknown as {
			on?: (name: string, callback: () => void) => EventRef;
		};
		if (typeof cache.on === "function") {
			// 'resolved' fires once the link index is rebuilt after an add/remove
			// or a rename, which is exactly when an unresolved link changes state.
			this.registerEvent(cache.on("resolved", repaintLinks));
		}
		const vaultEvents = this.app.vault as unknown as {
			on?: (name: string, callback: (file: TFile) => void) => EventRef;
		};
		if (typeof vaultEvents.on === "function") {
			// A rename can leave the grid showing an old target; redraw from data.
			this.registerEvent(vaultEvents.on("rename", repaintLinks));
			// Something outside Obsidian wrote to a CSV we have on screen (an
			// editor, a script, a sync client). Re-read it so the view and any
			// embeds of it stay truthful instead of showing stale rows.
			// The guard inside reloadFromDisk skips a grid with unsaved edits,
			// so this can never overwrite what the user is in the middle of.
			this.registerEvent(
				vaultEvents.on("modify", (file: TFile) => {
					void this.reloadFileFromDisk(file);
				}),
			);
		}


		// `![[file.csv]]` embeds are delegated to this plugin through the
		// embedRegistry, which is the only way to take over an embed: the public
		// API has no equivalent, and Obsidian would otherwise show its
		// "no handler" placeholder. The registered component mounts the same
		// GridController as the file view, so the embed is fully editable.
		const registry = (this.app as App & { embedRegistry?: EmbedRegistry }).embedRegistry;
		if (registry && !registry.isExtensionRegistered("csv")) {
			// Record that *we* added the registry entry. If another plugin
			// registered a "csv" embed first, `onunload` must leave it alone —
			// unregistering it would silently kill embeds for that plugin the
			// moment this one is disabled.
			this.registeredEmbedExtension = true;
			registry.registerExtension("csv", (context, file, subPath) => {
				return new CsvEmbedComponent(context.containerEl, this, file, {
					// Obsidian splits the linktext on the first "|", so `![[f.csv|5]]`
					// arrives as the container's `alt`, not as a parameter.
					rowLimit: parseRowLimit(context.containerEl.getAttr("alt")),
				});
			});
		}

	}

	/** Every embed currently on screen, so a settings toggle can reach them. */
	private liveEmbeds = new Set<CsvEmbedComponent>();

	trackEmbed(embed: CsvEmbedComponent): void {
		this.liveEmbeds.add(embed);
	}

	untrackEmbed(embed: CsvEmbedComponent): void {
		this.liveEmbeds.delete(embed);
	}

	/**
	 * Pushes the embed appearance settings onto the embeds already rendered.
	 *
	 * Without this a toggle would only affect embeds created afterwards, and
	 * the note the user is looking at would keep its old chrome until it
	 * happened to re-render.
	 */
	applyEmbedSettings(): void {
		for (const embed of this.liveEmbeds) {
			embed.applySettings({
				showAddButtons: this.settings.embedShowAddButtons,
				showStatus: this.settings.embedShowStatusBar,
			});
		}
	}

	/** Re-renders open views and embeds so new column width limits take effect immediately. */
	applyColumnWidthSettings(): void {
		this.refreshOpenGrids();
	}

	/**
	 * Makes CSVs show up in the Quick Switcher's recent files.
	 *
	 * Obsidian builds that list from `workspace.getRecentFiles`, and a `.csv`
	 * only comes back when the caller asks for non-image attachments — i.e. only
	 * when "Show attachments" is on. The Quick Switcher's "Show all file types"
	 * is applied AFTER the list is built, so with attachments off a CSV is
	 * dropped before that filter ever sees it, and the recents stay empty of
	 * CSVs even though typing their name finds them. Re-adding the CSVs the
	 * caller filtered out fixes exactly that and nothing else: every other
	 * attachment stays hidden, honouring the user's choice.
	 */
	private patchRecentFiles(): void {
		const workspace = this.app.workspace as unknown as {
			getRecentFiles?: (options?: RecentFilesOptions) => string[];
		};
		const original = workspace.getRecentFiles;
		if (typeof original !== "function") return;

		const bound = original.bind(workspace);
		const isCsv = (path: string): boolean =>
			path.toLowerCase().endsWith(`.${CSV_EXTENSION}`);
		workspace.getRecentFiles = (options?: RecentFilesOptions): string[] => {
			const result = bound(options);
			const max = options?.maxCount ?? 10;
			// The unfiltered list keeps recency order, so a CSV is spliced back
			// into its true position instead of being appended at the end.
			const full = bound({
				...options,
				showNonImageAttachments: true,
				maxCount: 200,
			});
			const kept = new Set(result);
			return full
				.filter((path) => kept.has(path) || isCsv(path))
				.slice(0, max);
		};

		this.register(() => {
			workspace.getRecentFiles = original;
		});
	}

	/**
	 * Disables and re-enables this plugin, which re-runs onload/onunload
	 * without restarting Obsidian. Pending edits are flushed first so a
	 * restart never discards the last cell the user typed.
	 */
	async restartPlugin(): Promise<void> {
		await this.flushPendingSaves();

		// Remember the CSV files currently open so they can be re-opened after
		// the plugin reloads, instead of dropping the user on the file explorer.
		const openPaths = this.app.workspace
			.getLeavesOfType(CSV_VIEW_TYPE)
			.map((leaf) => (leaf.view as FileView).file?.path)
			.filter((path): path is string => typeof path === "string");

		const registry = this.app as App & {
			plugins: PluginRegistry;
			setting?: SettingsManager;
		};
		const { id } = this.manifest;
		await registry.plugins.disablePlugin(id);
		// Let the unload/load cycle settle before the plugin is enabled again.
		await new Promise((resolve) => window.setTimeout(resolve, 100));
		await registry.plugins.enablePlugin(id);

		// Re-open the CSVs the user had open, now on the fresh view type.
		for (const path of openPaths) {
			void this.app.workspace.openLinkText(path, "", false, {
				eState: { type: CSV_VIEW_TYPE },
			});
		}

		// Put the user back on this plugin's settings tab. Disabling the plugin
		// closed it, and neither `enablePlugin` nor Obsidian brings it back, so
		// the restart looked like it kicked them out of Settings. Done last (the
		// CSV views above may grab focus) and on a short delay so `enablePlugin`
		// has finished registering the tab again.
		window.setTimeout(() => {
			registry.setting?.open?.();
			registry.setting?.openTabById?.(id);
		}, 100);

		new Notice("Plugin restarted");
	}

	private registerCommands(): void {
		const run = (fn: (view: CsvView) => void) => () => {
			// Only the CSV in front of the user. Running the command on every
			// open CSV meant an edit in one tab silently rewrote the others.
			const view = this.activeView();
			if (view) fn(view);
		};

		const commands: Array<[string, (view: CsvView) => void]> = [
			["add-row", (v) => v.addRow()],
			["remove-row", (v) => v.removeRow()],
			["add-column", (v) => v.addColumn()],
			["remove-column", (v) => v.removeColumn()],
			["move-row-up", (v) => v.moveRowUp()],
			["move-row-down", (v) => v.moveRowDown()],
			["move-column-left", (v) => v.moveColumnLeft()],
			["move-column-right", (v) => v.moveColumnRight()],
			["edit-cell", (v) => v.editFocusedCell()],
			["undo", (v) => v.undo()],
			["redo", (v) => v.redo()],
		];

		for (const [name, fn] of commands) {
			this.addCommand({
				id: name,

				name: humanize(name),
				callback: run(fn),
			});
		}

		this.addCommand({
			id: "save-csv",
			name: "Save CSV now",
			callback: () => {
				void (async () => {
					for (const view of this.views()) await this.saveView(view);
				})();
			},
		});

		this.addCommand({
			id: "create-csv",
			name: "Create new CSV",
			callback: () => {
				void this.createCsv();
			},
		});

	}

	/**
	 * Creates a new sheet and opens it in the grid.
	 *
	 * The only command that does not act on an open CSV — it is how a user gets
	 * a first one. Follows Obsidian's own "new file" behaviour: no prompt, the
	 * file is `Untitled.csv` (bumped to `Untitled 2.csv`, … when one already
	 * exists) in the folder of the file in front of the user, and it opens on a
	 * 1x1 sheet so there is a cell to click rather than an empty pane.
	 */
	private async createCsv(target?: TAbstractFile): Promise<void> {
		let folderPath = "";
		if (target) {
			folderPath =
				target instanceof TFolder ? target.path : (target.parent?.path ?? "");
		} else {
			const active = this.app.workspace.getActiveFile();
			folderPath = active?.parent?.path ?? "";
		}

		const path = untitledCsvPath(
			(candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null,
			folderPath,
		);

		try {
			await this.app.vault.create(path, NEW_CSV_CONTENT);
		} catch (error) {
			new Notice(
				`Could not create ${path}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}

		await this.app.workspace.openLinkText(path, "", false, {
			eState: { type: CSV_VIEW_TYPE },
		});
	}

	/**
	 * Redraws every open grid so link colouring reflects the current vault.
	 *
	 * Only presentation is redrawn: `refresh()` re-renders from the in-memory
	 * table, so no edit is lost and nothing is written to disk.
	 */
	private refreshOpenGrids(): void {
		for (const view of this.views()) view.refresh();
		for (const embed of this.liveEmbeds) embed.refresh();
	}

	/**
	 * Re-reads a CSV that changed on disk, into every view and embed showing it.
	 *
	 * Only CSVs are considered, and a grid holding unsaved edits is skipped
	 * (the save queue will push the user's version back out, which is the right
	 * resolution for an edit-vs-external conflict).
	 */
	private async reloadFileFromDisk(file: TFile): Promise<void> {
		if (!isCsvPath(file.path)) return;
		for (const view of this.views()) {
			if (view.file?.path === file.path) await view.reloadFromDisk();
		}
		for (const embed of this.liveEmbeds) {
			if (embed.file.path === file.path) await embed.reloadFromDisk();
		}
	}

	/**
	 * Whether this instance registered the "csv" embed in the app-wide
	 * registry, so `onunload` knows it may remove it again.
	 */
	private registeredEmbedExtension = false;

	private views(): CsvView[] {
		return this.app.workspace
			.getLeavesOfType(CSV_VIEW_TYPE)
			.map((leaf) => leaf.view)
			.filter((view): view is CsvView => view instanceof CsvView);
	}

	/**
	 * The CSV the user is actually looking at.
	 *
	 * Edit commands used to loop over every open view, which meant "add row"
	 * silently added a row to CSVs in other tabs. The active leaf decides which
	 * file the user means; a side pane or a second column is still a CSV, so any
	 * visible CSV leaf counts, with the focused one first.
	 */
	private activeView(): CsvView | undefined {
		const active = this.app.workspace.getActiveViewOfType(CsvView);
		if (active) return active;
		// The user may be in another tab with the CSV in a side pane; any open
		// CSV leaf still counts, and the first one is a sane fallback.
		const leaves = this.app.workspace
			.getLeavesOfType(CSV_VIEW_TYPE)
			.filter((leaf) => leaf.view instanceof CsvView);
		const first = leaves[0];
		return first ? (first.view as CsvView) : undefined;
	}

	private async flushPendingSaves(): Promise<void> {
		for (const timer of this.pending.values()) window.clearTimeout(timer);
		this.pending.clear();
		for (const view of this.views()) {
			await this.saveView(view);
		}
	}

	/** Debounced: rapid edits collapse into a single vault write. */
	requestSave(view: CsvView): void {
		const file = view.file;
		if (!file) return;
		const existing = this.pending.get(file.path);
		if (existing) window.clearTimeout(existing);
		this.pending.set(
			file.path,
			window.setTimeout(() => {
				this.pending.delete(file.path);
				void this.saveView(view);
			}, this.settings.saveDelayMs),
		);
	}

	/**
	 * Writes through Obsidian's own vault API, keeping the undo stack, sync and
	 * any open collaboration consistent with the rest of the app.
	 *
	 * The extension check is the last guard before a write. The view is a
	 * FileView, so a bug anywhere above could hand it a note; without this the
	 * note would be serialised as CSV and its frontmatter destroyed.
	 */
	async saveView(view: CsvView): Promise<boolean> {
		const file = view.file;
		if (!file || !isCsvPath(file.path)) return false;
		if (!view.isDirty()) return false;
		const data = view.getViewData();
		try {
			await this.app.vault.modify(file, data);
		} catch (error) {
			// A write can fail for reasons outside the plugin: the file is locked
			// by another program, the drive is offline, a sync client holds it.
			// Swallowing that leaves the user believing their edit is saved when
			// the bytes never reached disk.
			new Notice(
				`Could not save ${file.name}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return false;
		}
		// The baseline moves only after the write actually landed, and only if
		// the grid has not moved on since — see markSaved.
		view.markSaved(data);
		return true;
	}

	onunload(): void {
		if (this.repaintLinksTimer !== null) {
			window.clearTimeout(this.repaintLinksTimer);
			this.repaintLinksTimer = null;
		}
		const registry = (this.app as App & { embedRegistry?: EmbedRegistry }).embedRegistry;
		// Only remove the entry this instance added — see the note where it is
		// registered.
		if (registry && this.registeredEmbedExtension) {
			registry.unregisterExtension("csv");
			this.registeredEmbedExtension = false;
		}
		// Best-effort flush so a debounced edit is not lost when the plugin is
		// disabled or reloaded inside the save-delay window. `onunload` is
		// synchronous, so the write cannot be awaited, but it is started here
		// instead of being cancelled by the timer clear.
		void this.flushPendingSaves();
	}
}

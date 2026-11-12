import { Keymap, Menu, type App } from "obsidian";
import { findBacklinks } from "./backlinks.ts";

/**
 * A links panel that lives inside the CSV's own window.
 *
 * It lists the notes that link BACK to the CSV — the same thing Obsidian calls
 * "Linked mentions" in the Backlinks pane. The CSV's own outgoing wikilinks are
 * deliberately NOT shown: the grid already renders those as clickable links in
 * the cells, and a list of every note the sheet happens to mention is not the
 * question "what links here?" asks. Only outside files pointing IN belong here.
 *
 * The panel is built OUTSIDE the grid's `render()`, which throws its subtree
 * away on every edit. Mounted inside, the links would vanish on the first
 * keystroke; here only `refresh()` rewrites the list, and the grid can
 * re-render as often as it likes.
 */
export class LinksPanel {
	private root: HTMLElement;
	private host: HTMLElement;
	private sourcePath: string | null = null;

	constructor(
		private app: App,
		container: HTMLElement,
	) {
		this.root = container.createDiv({ cls: "super-csv-editor-links" });
		this.host = this.root.createDiv({ cls: "super-csv-editor-links-host" });
		this.render();
	}

	/** Points the panel at a file and redraws. */
	setFile(sourcePath: string | null): void {
		this.sourcePath = sourcePath;
		this.render();
	}

	/** Clears the panel, for when the leaf has no file. */
	clear(): void {
		this.setFile(null);
	}

	/**
	 * Redraws from the vault.
	 *
	 * Cheap enough to call after every link-index rebuild: it reads the
	 * metadata cache's own map, so there is no file I/O and no reparse.
	 */
	refresh(): void {
		this.render();
	}

	private render(): void {
		this.host.empty();
		const path = this.sourcePath;

		const incoming = path ? findBacklinks(this.app, path) : [];

		if (incoming.length === 0) {
			this.host.createDiv({
				cls: "super-csv-editor-links-empty",
				text: path
					? "No notes link to this CSV."
					: "Open a CSV to see its links.",
			});
			return;
		}

		// The label Obsidian's own Backlinks pane uses, above the single flat
		// list of notes pointing at this CSV.
		this.host.createEl("h4", {
			cls: "super-csv-editor-links-heading",
			text: "Linked mentions",
		});
		const list = this.host.createEl("ul");
		for (const link of incoming) {
			const item = list.createEl("li");
			const anchor = item.createEl("a", {
				cls: "internal-link",
				text: link.label,
				href: "#",
			});
			this.wireAnchor(anchor, link.file.path);
		}
	}

	/**
	 * Makes one row behave like any other Obsidian link.
	 *
	 * A plain click opens the target; a modifier or the middle mouse button
	 * opens it in a new tab or a split, exactly like a link in a note. The
	 * context menu is the SAME file menu Obsidian shows for a `[[wikilink]]`
	 * elsewhere — including "Open in new tab", "Open to the right", "Rename",
	 * "Delete" and the clipboard items — because it goes through the very call
	 * the markdown renderer makes for an internal link.
	 */
	private wireAnchor(anchor: HTMLAnchorElement, linktext: string): void {
		const open = (event: MouseEvent): void => {
			event.preventDefault();
			void this.app.workspace.openLinkText(
				linktext,
				this.sourcePath ?? "",
				Keymap.isModEvent(event),
			);
		};
		anchor.addEventListener("click", open);
		// A middle click arrives as `auxclick`, never as `click`; the other
		// non-primary buttons are ignored so a right click stays the menu's.
		anchor.addEventListener("auxclick", (event) => {
			if (event.button === 1) open(event);
		});
		anchor.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			this.showContextMenu(event, anchor, linktext);
		});
	}

	private showContextMenu(
		event: MouseEvent,
		anchor: HTMLElement,
		linktext: string,
	): void {
		// forEvent creates the menu and shows it at the pointer on a microtask,
		// which is what lets the item callbacks below be added first.
		const menu = Menu.forEvent(event);
		menu.setParentElement(anchor);
		// The editor's own wikilink menu declares these sections so each core
		// `file-menu` listener drops its items into the usual groups; without
		// it the items still appear but the section headings are missing.
		// `addSections` is not part of the public typings.
		(menu as Menu & { addSections?(sections: string[]): void }).addSections?.([
			"title",
			"open",
			"action",
			"clipboard",
			"view",
			"info",
			"",
			"danger",
		]);
		menu.addItem((item) =>
			item
				.setSection("clipboard")
				.setTitle("Copy")
				.setIcon("lucide-copy")
				.onClick(() => void navigator.clipboard?.writeText(anchor.textContent ?? "")),
		);
		// Resolves the link and triggers the standard `file-menu`, so every
		// open-in-new-tab / rename / delete item the app contributes shows up.
		// An unresolved target gets the "Create file" item instead.
		this.app.workspace.handleLinkContextMenu(menu, linktext, this.sourcePath ?? "");
	}

	dispose(): void {
		this.root.remove();
	}
}
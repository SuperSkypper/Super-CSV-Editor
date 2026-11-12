import type { App, TFile } from "obsidian";
import {
	applySuggestion,
	findWikiTrigger,
	linktextFor,
	rankCandidates,
	type LinkCandidate,
	type WikiTrigger,
} from "./linkSuggest.ts";

/**
 * The `[[` autocomplete popover for a cell editor.
 *
 * It is a plain absolutely-positioned list rather than an Obsidian
 * `SuggestModal`/`EditorSuggest`: those drive an Obsidian `Editor` or an
 * `<input>`, and the cell editor is a `<textarea>`. Only the candidates come
 * from Obsidian, so a suggestion resolves to the same file the native editor
 * would pick.
 *
 * The list is placed in `document.body` and positioned from the textarea's
 * bounding box, because the cell clips its overflow (`overflow: hidden`) and a
 * child popover would be cut off.
 */
export class LinkSuggestPopover {
	private el: HTMLElement | null = null;
	private items: LinkCandidate[] = [];
	private active = 0;
	private trigger: WikiTrigger | null = null;

	constructor(
		private app: App,
		/** Called with the finished value + caret once a suggestion is taken. */
		private onAccept: (value: string, caret: number) => void,
	) {}

	/** True while the popover is showing, so the editor can route arrow keys. */
	get isOpen(): boolean {
		return this.el !== null && this.items.length > 0;
	}

	/**
	 * Re-evaluates the `[[` state after any change to the textarea. Returns true
	 * when the popover is showing (the caller swallows navigation keys then).
	 */
	update(textarea: HTMLTextAreaElement): boolean {
		this.trigger = findWikiTrigger(textarea.value, textarea.selectionStart ?? 0);
		if (!this.trigger) {
			this.close();
			return false;
		}
		const all = this.candidates();
		this.items = rankCandidates(all, this.trigger.query);
		if (this.items.length === 0) {
			this.close();
			return false;
		}
		this.active = Math.min(this.active, this.items.length - 1);
		this.render(textarea);
		return true;
	}

	/** Moves the highlighted row; wraps at both ends like Obsidian's list. */
	move(delta: number): void {
		if (!this.isOpen) return;
		const n = this.items.length;
		this.active = (this.active + delta + n) % n;
		this.paintActive();
	}

	/** Accepts the highlighted suggestion and closes. */
	accept(textarea: HTMLTextAreaElement): void {
		const item = this.items[this.active];
		const trigger = this.trigger;
		if (!item || !trigger) return;
		const { value, caret } = applySuggestion(textarea.value, trigger, item.insert);
		this.close();
		this.onAccept(value, caret);
	}

	close(): void {
		this.el?.remove();
		this.el = null;
		this.items = [];
		this.active = 0;
		this.trigger = null;
	}

	// ── Internals ─────────────────────────────────────────────────────────

	/**
	 * Every linkable file, with the colliding basenames resolved to full paths.
	 * Built on demand: the vault can change between keystrokes, and a stale list
	 * would insert a link to a file the user just renamed.
	 */
	private candidates(): LinkCandidate[] {
		const files = this.app.vault.getFiles();
		const seen = new Map<string, number>();
		for (const f of files) {
			const key = f.basename.toLowerCase();
			seen.set(key, (seen.get(key) ?? 0) + 1);
		}
		return files.map((f: TFile) => ({
			path: f.path,
			basename: f.basename,
			insert: linktextFor(f, (seen.get(f.basename.toLowerCase()) ?? 0) > 1),
		}));
	}

		/** Places (or replaces) the list under the caret's line. */
	private render(textarea: HTMLTextAreaElement): void {
		if (!this.el) {
			this.el = document.body.createDiv({ cls: "super-csv-editor-suggest" });
		}
		this.el.empty();
		this.items.forEach((item, index) => {
			const row = this.el!.createDiv({ cls: "super-csv-editor-suggest-item" });
			if (index === this.active) row.addClass("is-active");

			// Same two-part row Obsidian's own popover uses: the note title,
			// then the folder path underneath it in muted text. Showing the path
			// for EVERY item (not only colliding basenames) is what makes a
			// vault with several "Notes" folders readable.
			row.createDiv({ cls: "super-csv-editor-suggest-name", text: item.basename });
			const note = row.createDiv({ cls: "super-csv-editor-suggest-note" });
			note.createDiv({ cls: "super-csv-editor-suggest-path", text: item.path });

			// Hover selects, exactly as the native popover does: the row under
			// the pointer is the one Enter accepts, so there is no separate
			// "point at it, then look down at the keyboard" step.
			row.addEventListener("mousemove", () => {
				if (this.active === index) return;
				this.active = index;
				this.paintActive();
			});
			// mousedown, not click: the textarea's blur would commit the cell and
			// tear the suggestion down before a click ever landed.
			row.addEventListener("mousedown", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.active = index;
				this.accept(textarea);
			});
		});
		this.position(textarea);
		this.scrollActiveIntoView();
	}

	private position(textarea: HTMLTextAreaElement): void {
		if (!this.el) return;
		const rect = textarea.getBoundingClientRect();
		this.el.style.top = `${rect.bottom + 2}px`;
		// Never wider than the window, and never hanging off its right edge.
		const width = Math.min(rect.width, 420);
		const left = Math.min(rect.left, window.innerWidth - width - 8);
		this.el.style.width = `${width}px`;
		this.el.style.left = `${Math.max(left, 4)}px`;
	}

	private paintActive(): void {
		if (!this.el) return;
		const rows = this.el.querySelectorAll<HTMLElement>(".super-csv-editor-suggest-item");
		rows.forEach((row, i) => row.toggleClass("is-active", i === this.active));
		this.scrollActiveIntoView();
	}

	private scrollActiveIntoView(): void {
		const row = this.el?.querySelectorAll<HTMLElement>(".super-csv-editor-suggest-item")[
			this.active
		];
		row?.scrollIntoView({ block: "nearest" });
	}
}

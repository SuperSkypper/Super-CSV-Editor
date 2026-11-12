// Minimal stand-in for the `obsidian` module so the browser harness can run
// the real GridController. Only the members the grid actually touches are
// implemented; anything else throws loudly rather than silently no-op'ing.
export class Notice {
	constructor(public message: string) {}
	setMessage(): this {
		return this;
	}
	hide(): void {}
}

export class Modal {
	constructor(public app: unknown) {}
	open(): void {}
	close(): void {}
	onOpen(): void {}
	onClose(): void {}
	contentEl: HTMLElement = document.body;
}

export class Menu {
	items: unknown[] = [];
	/** Records every menu built for an event so a check can assert on it. */
	static forEvent(_evt: unknown): Menu {
		const menu = new Menu();
		const g = globalThis as { __MENUS__?: Menu[] };
		g.__MENUS__ = (g.__MENUS__ ?? []).concat(menu);
		return menu;
	}
	addItem(): this {
		return this;
	}
	addSeparator(): this {
		return this;
	}
	setParentElement(): this {
		return this;
	}
	showAtMouseEvent(): void {}
	showAtPosition(): void {}
	hide(): void {}
	remove(): void {}
}

export class MenuItem {
	setTitle(): this {
		return this;
	}
	setIcon(): this {
		return this;
	}
	setSection(): this {
		return this;
	}
	setIsLabel(): this {
		return this;
	}
	onClick(): this {
		return this;
	}
	setDisabled(): this {
		return this;
	}
	setChecked(): this {
		return this;
	}
}

/** Mirrors the subset of `Keymap.isModEvent` the links panel relies on. */
export class Keymap {
	static isModEvent(
		evt?: {
			button?: number;
			ctrlKey?: boolean;
			metaKey?: boolean;
			altKey?: boolean;
			shiftKey?: boolean;
		} | null,
	): string | boolean {
		if (!evt) return false;
		if (evt.button === 1) return "tab";
		if (evt.ctrlKey || evt.metaKey) {
			if (evt.altKey) return evt.shiftKey ? "window" : "split";
			return "tab";
		}
		return false;
	}
}

export class Setting {
	constructor(public containerEl: unknown) {}
	setName(): this {
		return this;
	}
	setDesc(): this {
		return this;
	}
	addText(): this {
		return this;
	}
	addToggle(): this {
		return this;
	}
	addDropdown(): this {
		return this;
	}
	addButton(): this {
		return this;
	}
}

export class AbstractInputSuggest {
	constructor(public app: unknown, public textInputEl: HTMLElement) {}
	getSuggestions(): never {
		throw new Error("not used by the grid harness");
	}
	renderSuggestion(): void {}
	selectSuggestion(): void {}
	close(): void {}
}

/** Base lifecycle class; the embed extends it. */
export class Component {
	load(): void {}
	unload(): void {}
	onload(): void {}
	onunload(): void {}
	registerEvent(): void {}
	register(): void {}
	registerDomEvent(): void {}
	addChild<T>(child: T): T {
		return child;
	}
	removeChild<T>(child: T): T {
		return child;
	}
}

export class TFile {
	path = "";
	name = "";
	basename = "";
	extension = "";
}

export type App = unknown;
export type TAbstractFile = unknown;
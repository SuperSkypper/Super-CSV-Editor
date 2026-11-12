"use strict";
// Minimal Obsidian API mock: enough to load the built bundle and exercise the
// plugin lifecycle without the real app.
const registered = { commands: [], views: new Map(), extensions: [], markdownPostProcessors: [], keys: [] };

function classList() {
	const set = new Set();
	return {
		add: (...c) => c.forEach((x) => set.add(x)),
		remove: (...c) => c.forEach((x) => set.delete(x)),
		toggle: (c, on) => (on === undefined ? (set.has(c) ? (set.delete(c), false) : (set.add(c), true))
			: on ? (set.add(c), true) : (set.delete(c), false)),
		contains: (c) => set.has(c),
		_values: set,
	};
}

class FakeEl {
	constructor(tag = "div") {
		this.tagName = tag;
		this.children = [];
		this.parentElement = null;
		this.classList = classList();
		this.style = {};
		this.attrs = {};
		// Real DOM mirrors data-* into dataset; paint() reads dataset.row/col,
		// so the mock has to keep them in sync or every highlight test fails.
		this.dataset = new Proxy({}, {
			get: (_t, k) => (typeof k === "string" ? this.attrs["data-" + k] : undefined),
			set: (_t, k, v) => { this.attrs["data-" + k] = v; return true; },
			has: (_t, k) => "data-" + k in this.attrs,
		});
		this._text = "";
		this._listeners = {};
	}
	get textContent() { return this._text; }
	set textContent(v) { this._text = String(v); this.children = []; }
	// Real DOM keeps className and classList in sync; the find bar is the first
	// thing the plugin builds with `el.className = ...`, so the mock must too.
	get className() { return [...this.classList._values].join(" "); }
	set className(v) {
		this.classList._values.clear();
		String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList._values.add(c));
	}
	setText(v) { this._text = String(v); this.children = []; }
	getText() { return this._text; }
	appendText(v) { this._text += String(v); }
	appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
	removeChild(c) { this.children = this.children.filter((x) => x !== c); }
	remove() { this.parentElement?.removeChild(this); }
	empty() { this.children = []; this._text = ""; }
	addClass(c) { this.classList.add(c); }
	removeClass(c) { this.classList.remove(c); }
	hasClass(c) { return this.classList.contains(c); }
	toggleClass(c, on) { this.classList.toggle(c, on); }
	createEl(tag, o = {}) {
		const el = new FakeEl(tag);
		if (o.cls) o.cls.split(/\s+/).forEach((c) => el.classList.add(c));
		if (o.text !== undefined) el.setText(o.text);
		if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
		this.appendChild(el);
		return el;
	}
	createDiv(o) { return this.createEl("div", o); }
	createSpan(o) { return this.createEl("span", o); }
	setAttribute(k, v) { this.attrs[k] = v; }
	getAttribute(k) { return this.attrs[k] ?? null; }
	/** Obsidian's HTMLElement extension; the plugin reads the embed alias here. */
	setAttr(k, v) { this.attrs[k] = v; }
	getAttr(k) { return this.attrs[k] ?? null; }
	removeAttribute(k) { delete this.attrs[k]; }
	/** Listeners are stored so the harness can fire real events at the grid. */
	addEventListener(type, fn) {
		const list = this._listeners[type] ?? [];
		list.push(fn);
		this._listeners[type] = list;
	}
	removeEventListener(type, fn) {
		this._listeners[type] = (this._listeners[type] ?? []).filter((f) => f !== fn);
	}
	dispatch(type, event = {}) {
		for (const fn of this._listeners[type] ?? []) fn(event);
	}
	get listeners() { return this._listeners; }
	setAttributeNS(_ns, k, v) { this.attrs[k] = v; }
	/** Real containment, so the outside-click handler can be exercised. */
	contains(other) {
		if (other === this) return true;
		return this.children.some((c) => c.contains(other));
	}
	closest(selector) {
		const cls = selector.replace(/^\./, "");
		let n = this;
		while (n) {
			if (n.classList.contains(cls)) return n;
			n = n.parentElement;
		}
		return null;
	}
	/**
	 * Supports the one selector shape the plugin uses: a single class plus
	 * data-row/data-col, e.g. `.super-csv-editor-cell[data-row="1"][data-col="0"]`.
	 * Without this, startEdit() always bailed out and Enter looked broken.
	 */
	querySelector(selector) {
		const cls = (selector.match(/\.([a-z0-9-]+)/i) ?? [])[1];
		const row = (selector.match(/data-row="(\d+)"/) ?? [])[1];
		const col = (selector.match(/data-col="(\d+)"/) ?? [])[1];
		const walk = (el) => {
			for (const child of el.children) {
				if (
					cls &&
					child.classList.contains(cls) &&
					(row === undefined || child.attrs["data-row"] === row) &&
					(col === undefined || child.attrs["data-col"] === col)
				) {
					return child;
				}
				const hit = walk(child);
				if (hit) return hit;
			}
			return null;
		};
		return walk(this);
	}
	querySelectorAll() { return []; }
	getBoundingClientRect() { return { width: 100, height: 20, left: 0, top: 0, right: 100, bottom: 20 }; }
	scrollIntoView() {}
	/** Real focus tracking: the grid's keydown handler bails unless the
	 * container is document.activeElement. */
	focus() { globalThis.document.activeElement = this; }
	/** Mirrors a real blur: clears focus and fires the event listeners. */
	blur() { globalThis.document.activeElement = null; this.dispatch("blur", {}); }
	cloneNode() { return new FakeEl(this.tagName); }
	setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
	/** The inline editor and the find input select themselves on open. */
	select() { this.selectionStart = 0; this.selectionEnd = (this.value ?? "").length; }
	/** Text-field state, so the [[ autocomplete can be driven in the harness. */
	selectionStart = 0;
	selectionEnd = 0;
	spellcheck = true;
	value = "";
	dispatchEvent() {}
}

class Component {
	constructor() { this._children = []; }
	onload() {}
	onunload() {}
	load() { this.onload(); return this; }
	unload() { this.onunload(); this._children.forEach((c) => c.unload?.()); }
	addChild(c) { this._children.push(c); return c; }
	removeChild(c) { this._children = this._children.filter((x) => x !== c); }
	registerEvent() {}
	registerDomEvent(el, type, fn) { el?.addEventListener?.(type, fn); }
	register() {}
}

class Plugin extends Component {
	constructor(app, manifest) { super(); this.app = app; this.manifest = manifest; }
	addCommand(c) { registered.commands.push(c); return c; }
	addSettingTab() {}
	addRibbonIcon() { return new FakeEl(); }
	registerView(type, factory) { registered.views.set(type, factory); }
	registerExtensions(exts, type) { registered.extensions.push({ exts, type }); }
	registerMarkdownPostProcessor(fn) { registered.markdownPostProcessors.push(fn); }
	async loadData() { return globalThis.__PLUGIN_DATA__ ?? null; }
	async saveData() {}
}

class Modal extends Component {
	constructor(app) { super(); this.app = app; this.contentEl = new FakeEl(); }
	close() {}
	open() { this.onOpen(); }
}
class Notice { constructor(msg) { globalThis.__NOTICES__ = (globalThis.__NOTICES__ ?? []).concat(msg); } }
class Setting {
	constructor(el) { this.el = el; }
	setName() { return this; }
	setDesc() { return this; }
	addText() { return this; }
	addButton() { return this; }
	addToggle() { return this; }
	addDropdown() { return this; }
}
/**
 * Records every item so the harness can assert on menu CONTENTS, not just that
 * a menu opened. `mock.__lastMenu` holds the most recent one.
 */
class Menu {
	constructor() { this.items = []; globalThis.__lastMenu = this; }
	static forEvent() { return new Menu(); }
	addItem(build) {
		const item = {
			title: "",
			icon: "",
			section: "",
			disabled: false,
			clicked: false,
			setTitle(v) { this.title = v; return this; },
			setIcon(v) { this.icon = v; return this; },
			setSection(v) { this.section = v; return this; },
			setIsLabel(v) { this.isLabel = v; return this; },
			setWarning(v) { this.warning = v; return this; },
			setDisabled(v) { this.disabled = v; return this; },
			onClick(fn) { this.clicked = true; this.callback = fn; return this; },
		};
		build(item);
		this.items.push(item);
		return this;
	}
	addSeparator() { this.items.push({ separator: true }); return this; }
	addSections() { return this; }
	setParentElement() { return this; }
	showAtMouseEvent() {}
	showAtPosition() {}
	hide() {}
	remove() {}
}
/** Mirrors the subset of `Keymap.isModEvent` the links panel relies on. */
class Keymap {
	static isModEvent(evt) {
		if (!evt) return false;
		if (evt.button === 1) return "tab";
		if (evt.ctrlKey || evt.metaKey) return evt.altKey ? "split" : "tab";
		return false;
	}
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } display() {} }
// Mirrors Obsidian's Scope closely enough to exercise the keymap: handlers are
// kept per scope, the first match wins, `undefined` falls through to the parent
// and any other value (including `false`) is the result.
function compileModifiers(modifiers) {
	return modifiers.map((m) => (m === "Mod" ? "Ctrl" : m)).sort().join(",");
}
function handlerMatches(handler, ctx) {
	if (handler.modifiers !== null && handler.modifiers !== ctx.modifiers) return false;
	if (!handler.key) return true;
	if (handler.key === ctx.vkey) return true;
	return !!ctx.key && handler.key.toLowerCase() === ctx.key.toLowerCase();
}
class Scope {
	constructor(parent = null) {
		this.parent = parent;
		this.keys = [];
	}
	register(modifiers, key, func) {
		const handler = {
			scope: this,
			modifiers: modifiers ? compileModifiers(modifiers) : null,
			key,
			func,
		};
		this.keys.push(handler);
		registered.keys.push(handler);
		return handler;
	}
	unregister(handler) {
		this.keys = this.keys.filter((h) => h !== handler);
	}
	handleKey(event, ctx) {
		for (const handler of this.keys) {
			if (!handlerMatches(handler, ctx)) continue;
			const result = handler.func(event, ctx);
			if (result !== undefined) return result;
			if (handler.key !== null || handler.modifiers !== null) return result;
		}
		return this.parent ? this.parent.handleKey(event, ctx) : undefined;
	}
}
class FileView extends Component {
	// The real FileView exposes `app` (and `containerEl`) on the instance; the
	// grid reaches for it, so the mock mirrors that instead of forcing every
	// caller to pass the app down separately.
	constructor(leaf) {
		super();
		this.leaf = leaf;
		this.app = leaf?.app ?? globalThis.__APP__;
		this.containerEl = new FakeEl();
		// Created by the base View, right-clicked by the plugin's header handler.
		this.headerEl = new FakeEl();
		this.contentEl = new FakeEl();
		// The real View nests both inside containerEl, so containment checks
		// (e.g. "was this key pressed inside the view?") behave as they do live.
		this.containerEl.appendChild(this.headerEl);
		this.containerEl.appendChild(this.contentEl);
		this.file = null;
		// The base View leaves its scope null; a view that wants a key creates
		// its own and assigns it here, which is what the workspace then consults.
		this.scope = null;
	}
	// The base View's no-op hook; CsvView overrides it and calls through, so it
	// must exist or `super.onPaneMenu` throws.
	onPaneMenu() {}
	onRename() {}
}
// The real helper paints an <svg>; the mock only needs it not to crash and to
// leave a mark so the harness can see the icon slot was filled.
function setIcon(el, iconId) {
	if (el?.addClass) {
		el.addClass("svg-icon");
		el.setAttr("data-icon", iconId);
	}
}
class TFile {
	constructor(path) {
		this.path = path;
		this.name = path.split("/").pop();
		this.extension = this.name.split(".").pop();
		this.basename = this.name.slice(0, this.name.length - this.extension.length - 1);
	}
}
class TFolder { constructor(path) { this.path = path; } }

module.exports = {
	__registered: registered,
	FakeEl,
	Component,
	Plugin,
	Modal,
	Notice,
	Setting,
	Menu,
	Keymap,
	PluginSettingTab,
	Scope,
	setIcon,
	FileView,
	TFile,
	TFolder,
};

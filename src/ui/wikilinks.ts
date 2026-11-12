import { formatDisplayValue } from "./format.ts";
/**
 * Wikilinks inside CSV cells.
 *
 * The CSV on disk keeps the raw `[[...]]` text: only the rendering turns it into
 * a link. Rejoining the segments reproduces the original string exactly, which
 * is what makes this safe to render and still write the file back unchanged.
 */

export interface TextSegment {
	kind: "text";
	value: string;
}

export interface LinkSegment {
	kind: "link";
	target: string;
	alias: string | null;
	heading?: string;
	blockId?: string;
	/** What the user actually sees in the cell. */
	display: string;
	/** The original `[[...]]` text, so segments rejoin to the exact input. */
	value: string;
}

export type Segment = TextSegment | LinkSegment;

/** A link cannot span lines, and the brackets must close. */
const WIKILINK = /\[\[([^[\]\n]+)\]\]/g;

/**
 * Vault reality: titles here contain apostrophes (`Uta's Past`), commas
 * (`Superman's Girl Friend, Lois Lane`) and slashes (`03🎮Games/One Piece`),
 * so the target is taken whole and only `|` and `#` are treated as separators.
 */
export function splitWikilinks(value: string): Segment[] {
	if (!value) return [];
	if (!value.includes("[[")) return [{ kind: "text", value }];

	const segments: Segment[] = [];
	let cursor = 0;

	for (const match of value.matchAll(WIKILINK)) {
		const start = match.index;
		if (start > cursor) {
			segments.push({ kind: "text", value: value.slice(cursor, start) });
		}
		segments.push(parseTarget(match[1] ?? "", match[0]));
		cursor = start + match[0].length;
	}

	if (cursor < value.length) {
		segments.push({ kind: "text", value: value.slice(cursor) });
	}
	return segments;
}

function parseTarget(inner: string, raw: string): LinkSegment {
	// The alias is the LAST pipe: a title may legitimately contain one.
	const pipe = inner.lastIndexOf("|");
	const linkPart = pipe === -1 ? inner : inner.slice(0, pipe);
	const alias = pipe === -1 ? null : inner.slice(pipe + 1);

	const hash = linkPart.indexOf("#");
	const target = hash === -1 ? linkPart : linkPart.slice(0, hash);
	const rest = hash === -1 ? "" : linkPart.slice(hash + 1);

	const caret = rest.indexOf("^");
	const heading = caret === -1 ? rest || undefined : rest.slice(0, caret) || undefined;
	const blockId = caret === -1 ? undefined : rest.slice(caret + 1) || undefined;

	return {
		kind: "link",
		target,
		alias,
		...(heading ? { heading } : {}),
		...(blockId ? { blockId } : {}),
		display: alias ?? (heading ? `${target} > ${heading}` : target),
		value: raw,
	};
}

/**
 * The exact text a cell renders for a raw value: link segments contribute
 * their display text, text segments contribute their own text, and the whole
 * thing is joined back into a string. Auto-fit measures THIS, never the raw
 * `[[target|alias]]` text, so a column is never sized for markup the user
 * never sees.
 */
export function displayText(value: string): string {
	if (!value) return "";
	let out = "";
	for (const segment of splitWikilinks(value)) {
		out += segment.kind === "link" ? segment.display : formatDisplayValue(segment.value).replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1");
	}
	return out;
}

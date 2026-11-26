/**
 * Invisible bidi/format marks that leak into some vault headers (516 U+200E
 * occurrences in this vault alone). Written as escapes so the source stays
 * readable and free of literal control characters.
 */
const INVISIBLE =
	/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\ufeff]/g;

export function stripInvisible(value: string): string {
	return value.replace(INVISIBLE, "");
}

/**
 * Approximate rendered column count. CJK and emoji occupy more than one column,
 * so a plain `.length` would misalign a grid built from emoji-heavy titles.
 */
export function cellDisplayWidth(value: string): number {
	const text = stripInvisible(value);
	let width = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		if (code >= 0x1100 && code <= 0x115f) width += 2; // Hangul Jamo
		else if (code >= 0x2e80 && code <= 0xa4cf) width += 2; // CJK
		else if (code >= 0xac00 && code <= 0xd7a3) width += 2; // Hangul
		else if (code >= 0xf900 && code <= 0xfaff) width += 2; // CJK compat
		else if (code >= 0xfe30 && code <= 0xfe6f) width += 2; // CJK compat forms
		else if (code >= 0xff00 && code <= 0xff60) width += 2; // Fullwidth
		else if (code >= 0xffe0 && code <= 0xffe6) width += 2; // Fullwidth signs
		else if (code >= 0x1f000 && code <= 0x1f2ff) width += 2; // Mahjong / cards
		else if (code >= 0x1f300 && code <= 0x1faff) width += 2; // Emoji
		else if (code >= 0x1f900 && code <= 0x1f9ff) width += 2; // Supplemental emoji
		else if (code >= 0x20000 && code <= 0x3fffd) width += 2; // CJK ext
		else width += 1;
	}
	return width;
}

/**
 * ISO datetimes ("2026-08-27T22:33:01") are a write format, not a reading
 * format. Inside the grid we show the same instant as "2026/08/27 22:33:01":
 * dashes become slashes, the "T" becomes a space, and any zone/millisecond
 * suffix is dropped. The CSV on disk keeps the original text; this is purely
 * how a cell is rendered.
 *
 * Only values that ARE the datetime get rewritten — a longest-match anchor
 * would silently rewrite dates embedded in a title or a wikilink target.
 */
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?!\d).*$/;
// A bare ISO date with no time part: "2022-05-08" -> "2022/05/08".
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDisplayValue(value: string): string {
	// Fast path: ISO dates/datetimes always start with "YYYY-" (length >= 10).
	if (value.length < 10 || value.charCodeAt(4) !== 45) return value;
	const match = ISO_DATETIME.exec(value);
	if (match) {
		const [, year, month, day, hour, minute, second] = match;
		const time = second ? `${hour}:${minute}:${second}` : `${hour}:${minute}`;
		return `${year}/${month}/${day} ${time}`;
	}
	const dateOnly = ISO_DATE.exec(value);
	if (dateOnly) {
		const [, year, month, day] = dateOnly;
		return `${year}/${month}/${day}`;
	}
	return value;
}

const CANDIDATES = [",", ";", "\t", "|"];

/**
 * Invisible bidi/format marks that leak into some vault headers (516 U+200E
 * occurrences in this vault alone). Written as escapes so the source stays
 * readable and free of literal control characters.
 */
const INVISIBLE =
	/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\ufeff]/g;

function countColumns(text: string, delimiter: string): number {
	const lines = text.split("\n").slice(0, 20);
	let max = 0;
	for (const line of lines) {
		let count = 1;
		let inQuotes = false;
		for (const ch of line.replace(INVISIBLE, "")) {
			if (ch === '"') inQuotes = !inQuotes;
			else if (!inQuotes && ch === delimiter) count++;
		}
		if (count > max) max = count;
	}
	return max;
}

/**
 * Guesses the delimiter from the first lines of a file. The candidate producing
 * the most columns wins; ties fall back to comma.
 */
export function detectDelimiter(text: string): string {
	const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
	let best = ",";
	let bestCount = 1;
	for (const candidate of CANDIDATES) {
		const count = countColumns(sample, candidate);
		if (count > bestCount) {
			best = candidate;
			bestCount = count;
		}
	}
	return best;
}

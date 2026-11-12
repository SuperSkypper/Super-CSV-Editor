import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { detectDelimiter } from "./detect.ts";
import { columnCount, parseCsv, stringifyCsv } from "./csv.ts";

const VAULT = process.env.VAULT_PATH;
const shouldRun = Boolean(VAULT);

function collectCsv(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stats = statSync(full);
		if (stats.isDirectory()) {
			if (entry === ".obsidian" || entry === ".trash") continue;
			collectCsv(full, acc);
		} else if (entry.toLowerCase().endsWith(".csv")) {
			acc.push(full);
		}
	}
	return acc;
}

// Round-tripping the real vault is the only proof that the parser matches the
// files it will actually be asked to save over.
describe("round-trip against the real vault", { skip: !shouldRun }, () => {
	const files = shouldRun ? collectCsv(VAULT!) : [];

	it("finds the vault's CSV files", () => {
		assert.ok(files.length > 0, "no CSV files found");
	});

	it("parses and re-serializes every file byte-for-byte", () => {
		const failures: string[] = [];
		for (const file of files) {
			const raw = readFileSync(file, "utf-8");
			const delimiter = detectDelimiter(raw);
			const table = parseCsv(raw, delimiter);
			const out = stringifyCsv(table, delimiter);
			if (out !== raw) {
				const rel = relative(VAULT!, file);
				const at = [...raw].findIndex((c, i) => c !== out[i]);
				failures.push(
					`${rel}: differs at offset ${at} (rows=${table.rows.length} cols=${columnCount(table)})`,
				);
			}
		}
		assert.deepEqual(failures.slice(0, 10), [], `${failures.length} file(s) changed`);
	});

	it("never loses a cell across the round-trip", () => {
		for (const file of files) {
			const raw = readFileSync(file, "utf-8");
			const delimiter = detectDelimiter(raw);
			const table = parseCsv(raw, delimiter);
			const cellCount = table.rows.reduce((n, r) => n + r.length, 0);
			const reparsed = parseCsv(stringifyCsv(table, delimiter), delimiter);
			const after = reparsed.rows.reduce((n, r) => n + r.length, 0);
			assert.equal(after, cellCount, relative(VAULT!, file));
		}
	});
});

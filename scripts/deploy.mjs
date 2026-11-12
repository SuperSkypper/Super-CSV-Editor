/**
 * Copies the built plugin into the vault's plugin folder.
 *
 * Obsidian loads whatever sits in `.obsidian/plugins/<id>/`, NOT this project
 * directory. A `npm run build` here therefore changes nothing in the app until
 * the files are copied, which is exactly how several fixes looked like they did
 * nothing: the vault was still running a build from the day before.
 *
 * The destination comes from CSV_PLUGIN_DIR, which must point at the vault's
 * plugin folder.
 */
import { copyFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const project = path.resolve(import.meta.dirname, "..");
const target = process.env.CSV_PLUGIN_DIR;

if (!target) {
	console.error(
		"Set CSV_PLUGIN_DIR to the vault's plugin folder, e.g.\n" +
			'  CSV_PLUGIN_DIR="<vault>/.obsidian/plugins/super-csv-editor" npm run deploy',
	);
	process.exit(1);
}

if (!existsSync(target)) {
	console.error(`Plugin folder not found:\n  ${target}`);
	process.exit(1);
}

// manifest.json is included so the id/version cannot drift from the build, but
// data.json (the user's settings) is deliberately NOT touched.
const files = ["main.js", "styles.css", "manifest.json"];
for (const file of files) {
	const from = path.join(project, file);
	if (!existsSync(from)) {
		console.error(`missing build output: ${file}`);
		process.exit(1);
	}
	copyFileSync(from, path.join(target, file));
	const kb = (statSync(path.join(target, file)).size / 1024).toFixed(1);
	console.log(`  ${file.padEnd(14)} ${kb} kB`);
}

console.log(`\nDeployed to ${target}`);
console.log(
	'Reload the plugin in Obsidian: Settings > Community plugins (toggle it off/on), or the plugin\'s own "Restart plugin" button.',
);

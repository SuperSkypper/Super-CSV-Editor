"use strict";
// Playwright module and Chromium binary used by the browser harnesses.
//
// Both come from the environment so no machine-specific path lives in the
// repository:
//   PLAYWRIGHT_MODULE  path to an installed `playwright` package
//   CHROME_PATH        executable of a Chromium/Chrome build
//
// When they are unset, Playwright is resolved through a normal module lookup
// and launching without `executablePath` uses the browser it downloaded.
const path = require("node:path");

function resolvePlaywright() {
	if (process.env.PLAYWRIGHT_MODULE) {
		return path.resolve(process.env.PLAYWRIGHT_MODULE);
	}
	for (const candidate of ["playwright", "playwright-core"]) {
		try {
			return require.resolve(candidate);
		} catch {
			// try the next candidate
		}
	}
	console.error(
		"playwright not found. Install it (npm i -D playwright) or set PLAYWRIGHT_MODULE to its path.",
	);
	process.exit(1);
}

module.exports = {
	PLAYWRIGHT: resolvePlaywright(),
	CHROME: process.env.CHROME_PATH || undefined,
};

#!/usr/bin/env node

// The launcher exists so that the file `bin` points at is always present.
//
// A package manager links a bin during install, and npm does it by creating the
// link and then marking the target executable. On Linux and macOS that chmod
// fails with ENOENT when the target is not there yet, and npm skips the link
// without saying so. In this repository `dist/cli/main.js` is generated — on a
// first install it does not exist, the CLI never reaches PATH, and every example
// build dies with `i18n-fs: not found`.
//
// Windows has no chmod step, so the shim was written anyway and the problem was
// invisible on the development machine. It only surfaced on CI.
//
// This file is committed. It exists at every install, on every platform, under
// every package manager, so the link is always made and one install is enough.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const entry = new URL('../dist/cli/main.js', import.meta.url);

// Checked rather than caught: a caught ERR_MODULE_NOT_FOUND cannot be told apart
// from one thrown by the CLI's own imports without matching on a message whose
// path separators differ by platform.
if (!existsSync(fileURLToPath(entry))) {
	console.error(
		'i18n-fs is installed but not built.\n' +
			'Run `npm run bootstrap` from the repository root.',
	);
	process.exit(1);
}

await import(entry.href);

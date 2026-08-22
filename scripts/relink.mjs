// Clears the workspace consumers' node_modules so the next install can link
// binaries that did not exist the first time round.
//
// pnpm creates a package's `bin` shims during install, by looking at the file
// the `bin` field points at. `i18n-fs` builds its CLI to `dist/cli/main.js`,
// which cannot exist before the first install has provided the tools to build
// it — so that install logs "Failed to create bin" and moves on. A second
// install is not enough on its own: pnpm sees an up-to-date tree and does
// nothing. Removing the tree is what makes it relink.

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examples = join(root, 'examples');

if (!existsSync(examples)) process.exit(0);

for (const entry of readdirSync(examples, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;

	const modules = join(examples, entry.name, 'node_modules');
	if (existsSync(modules)) {
		rmSync(modules, { recursive: true, force: true });
		console.log(`relink: cleared ${entry.name}/node_modules`);
	}
}

// Copies the three wasm-pack outputs into the npm package.
//
// wasm-pack writes a package.json into each pkg directory; we do not want those
// nested manifests inside our own package, so only the artefacts are copied.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'crates', 'i18n-fs-wasm', 'pkg');
const to = join(root, 'packages', 'i18n-fs', 'wasm');

const TARGETS = ['edge', 'browser', 'node'];
const SKIP = new Set(['package.json', 'README.md', '.gitignore', 'LICENSE']);

if (!existsSync(from)) {
	console.error('No wasm build found. Run `pnpm wasm:build` first.');
	process.exit(1);
}

rmSync(to, { recursive: true, force: true });

for (const target of TARGETS) {
	const source = join(from, target);
	if (!existsSync(source)) {
		console.error(`Missing wasm build for ${target}. Run \`pnpm wasm:build\`.`);
		process.exit(1);
	}

	mkdirSync(join(to, target), { recursive: true });
	cpSync(source, join(to, target), {
		recursive: true,
		filter: (src) => !SKIP.has(basename(src)),
	});
}

// wasm-pack's `nodejs` target emits CommonJS, but the package declares
// `"type": "module"`, so Node would parse it as ESM and `__dirname` — which the
// glue uses to locate the .wasm file — would not exist. A scoped type marker
// applies to this directory only. The `browser` and `edge` outputs are ESM
// already and need no marker.
writeFileSync(
	join(to, 'node', 'package.json'),
	`${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
);

console.log(`Synced ${TARGETS.join(', ')} into packages/i18n-fs/wasm`);

// Last line of defence before `npm publish`.
//
// Everything here has already failed once in this project's history, or is
// exactly the kind of thing that fails silently and is discovered by whoever
// installs the package rather than by whoever published it.

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(pkg, '..', '..');
const dist = join(pkg, 'dist');
const wasm = join(pkg, 'wasm');

const problems = [];

function require_(path, why) {
	if (!existsSync(path)) problems.push(`missing ${path.slice(pkg.length + 1)} — ${why}`);
}

function requireFirstLine(file, expected, why) {
	const path = join(dist, file);
	if (!existsSync(path)) return problems.push(`missing dist/${file}`);

	const first = readFileSync(path, 'utf8').split('\n', 1)[0];
	if (!first.startsWith(expected)) {
		problems.push(`dist/${file} does not start with ${JSON.stringify(expected)} — ${why}`);
	}
}

// The README and the licence are single-sourced at the repository root; copying
// them at publish time is what stops the npm page drifting from the repository.
for (const file of ['README.md', 'LICENSE']) {
	copyFileSync(join(root, file), join(pkg, file));
}

// Every entry point named in `exports` has to exist.
const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
for (const [name, entry] of Object.entries(manifest.exports)) {
	if (typeof entry !== 'object') continue;
	for (const target of Object.values(entry)) {
		if (typeof target === 'string' && target.startsWith('./')) {
			require_(join(pkg, target), `declared by exports["${name}"]`);
		}
	}
}

// The runtime-selected bindings are reached through `imports`, not `exports`,
// so nothing above covers them.
for (const target of Object.values(manifest.imports['#core-bindings'])) {
	require_(join(pkg, target), 'declared by imports["#core-bindings"]');
}

requireFirstLine('cli/main.js', '#!/usr/bin/env node', 'the CLI would not be executable');
requireFirstLine('client/index.js', "'use client'", 'React would treat it as a Server Component');
requireFirstLine('navigation.js', "'use client'", 'React would treat it as a Server Component');

// A second copy of the context means a Link reads state the provider never
// populated, which surfaces as "No I18nProvider found" on a page that has one.
for (const file of ['navigation.js', 'server/index.js']) {
	const source = readFileSync(join(dist, file), 'utf8');
	if (source.includes('createContext')) {
		problems.push(`dist/${file} inlines the React context instead of importing i18n-fs/client`);
	}
}

// The Edge and Node binaries are embedded; the browser one is fetched.
for (const target of ['edge', 'node']) {
	require_(join(wasm, target, 'bytes.mjs'), 'the embedded binary');
	require_(join(wasm, target, 'i18n_fs_wasm.js'), 'the loader glue');
}
require_(join(wasm, 'browser', 'i18n_fs_wasm_bg.wasm'), 'the browser binary is not embedded');

if (problems.length) {
	console.error('Refusing to publish:\n');
	for (const problem of problems) console.error(`  - ${problem}`);
	console.error('\nRun `pnpm bootstrap` from the repository root and try again.');
	process.exit(1);
}

console.log(`i18n-fs ${manifest.version} looks publishable.`);

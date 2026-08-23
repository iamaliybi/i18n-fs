// Last line of defence before `npm publish`.
//
// Everything here has already failed once in this project's history, or is
// exactly the kind of thing that fails silently and is discovered by whoever
// installs the package rather than by whoever published it.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
//
// The README's relative links have to become absolute on the way. npm resolves
// them against the package's directory in the repository, so `docs/guide/…`
// would point at `packages/i18n-fs/docs/guide/…`, which does not exist — every
// documentation link on the npm page would 404.
const REPO = 'https://github.com/iamaliybi/i18n-fs';

const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(
	/\]\((?!https?:|#|mailto:)([^)]+)\)/g,
	(_match, target) => {
		const kind = target.endsWith('/') ? 'tree' : 'blob';
		return `](${REPO}/${kind}/main/${target.replace(/\/$/, '')})`;
	},
);

writeFileSync(join(pkg, 'README.md'), readme);
copyFileSync(join(root, 'LICENSE'), join(pkg, 'LICENSE'));

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

// The file `bin` points at must be committed, not generated. A package manager
// links a bin during install, and npm marks the target executable as it does so
// — which fails silently on Linux and macOS when the target does not exist yet,
// leaving the CLI off PATH. That is a CI-only failure on a Windows machine, so
// it is asserted here rather than trusted.
for (const target of Object.values(manifest.bin)) {
	const path = join(pkg, target);

	require_(path, 'declared by bin');

	if (!readFileSync(path, 'utf8').startsWith('#!/usr/bin/env node')) {
		problems.push(`${target} has no shebang — the CLI would not be executable`);
	}

	if (target.startsWith('./dist/')) {
		problems.push(
			`bin points at ${target}, which is generated — ` +
				'a first install cannot link it, so the CLI would not be on PATH',
		);
	}
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

// The version check the runtime performs, performed here instead — before the
// artefact leaves the machine rather than after it reaches a user.
//
// This is the trap the version stamp created: bumping the version and
// publishing without rebuilding produces a package whose binary is stamped with
// the *old* version, and whose loader then throws for everyone who installs it.
// Nothing above would notice, because every file it checks exists and is
// perfectly well formed.
if (!problems.length) {
	const entry = pathToFileURL(join(dist, 'index.js')).href;

	try {
		const { VERSION, loadFullCore } = await import(entry);

		if (VERSION !== manifest.version) {
			problems.push(
				`dist reports version ${VERSION} but package.json says ${manifest.version} — ` +
					'the JavaScript was built before the version was bumped',
			);
		}

		const compiled = (await loadFullCore()).coreVersion();
		if (compiled !== manifest.version) {
			problems.push(
				`the compiled core reports version ${compiled} but package.json says ` +
					`${manifest.version} — the WebAssembly was built before the version was bumped`,
			);
		}
	} catch (error) {
		problems.push(`could not load the built package: ${error.message}`);
	}
}

if (problems.length) {
	console.error('Refusing to publish:\n');
	for (const problem of problems) console.error(`  - ${problem}`);
	console.error('\nRun `npm run bootstrap` from the repository root and try again.');
	process.exit(1);
}

console.log(`i18n-fs ${manifest.version} looks publishable, and both halves agree on the version.`);

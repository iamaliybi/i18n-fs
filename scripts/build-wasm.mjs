// Builds the three WASM targets from the single `i18n-fs-wasm` crate.
//
// They differ in two ways that matter:
//
//   * the wasm-pack target decides the JS glue (ESM with bundler imports, a
//     `fetch`-based web loader, or CommonJS for Node);
//   * the cargo feature set decides what is compiled in at all.
//
// The `edge` build is compiled with --no-default-features, so message storage
// and formatting — and with them serde_json — are absent from the binary rather
// than merely unreferenced. Tree-shaking cannot remove code from a .wasm file,
// so this has to happen at compile time.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crate = join(root, 'crates', 'i18n-fs-wasm');

// The npm package version, stamped into each binary so the JavaScript loader
// can refuse a `wasm/` directory left over from a different version. The crates
// are never published and stay at 0.0.0, so their own version says nothing a
// consumer would recognise.
const VERSION = JSON.parse(
	readFileSync(join(root, 'packages', 'i18n-fs', 'package.json'), 'utf8'),
).version;

/** @type {{name: string, target: string, features: string[], budgetKb: number}[]} */
const BUILDS = [
	{
		name: 'edge',
		// `web`, not `bundler`. The bundler glue resolves its `.wasm` at runtime
		// through a relative URL, and the Edge runtime has no base to resolve it
		// against — the middleware then throws "Failed to parse URL from
		// /_next/static/wasm/....wasm" on the first request. The web glue takes
		// the bytes as an argument instead, and `sync-wasm.mjs` embeds them.
		target: 'web',
		features: ['routing'],
		// This is the binary that runs on every request, so it is the one whose
		// growth is worth arguing about.
		//
		// It was 60.4 KB gzip, of which roughly a third was `serde-wasm-bindgen`
		// deserialising a configuration that never changes while the process
		// lives. The config now crosses once, as primitives, and the serialiser
		// is not compiled in at all — the surface test asserts that by looking
		// for its error strings in the bytes. See ADR 0001.
		//
		// Re-baselined at 40 KB from a measured 38.3.
		budgetKb: 40,
	},
	{
		name: 'browser',
		target: 'web',
		// No `routing`. This is the only binary a visitor downloads, and it never
		// routes: `<Link>` and `usePathname` are answered by a TypeScript mirror
		// of the same rules so they stay synchronous, and every redirect decision
		// is made by the proxy before the page is served. Compiling routing in
		// cost 34 KB gzip that no browser ever executed.
		features: ['full'],
		// Measured after that removal, not a target. It was 95 KB when the binary
		// carried routing as well.
		budgetKb: 60,
	},
	{
		name: 'node',
		// `web`, not `nodejs`, even though this build runs under Node. The
		// `nodejs` glue locates its own `.wasm` with `__dirname`, which every
		// bundler rewrites to somewhere the file was never copied — the failure
		// then happens at request time, long after the build reported success.
		// The `web` glue instead accepts the bytes as an argument, and
		// `sync-wasm.mjs` embeds them, so nothing has to resolve a path at all.
		target: 'web',
		// `cli` adds namespace introspection — which keys exist and what shape
		// each holds — for the build-time CLI. It is in this build and not the
		// browser one because the browser resolves messages, it never enumerates
		// them, and this binary is read from disk rather than downloaded.
		features: ['full', 'cli', 'routing'],
		budgetKb: 100,
	},
];

// wasm-pack looks for a licence beside the crate it is packaging and warns on
// every build when there is not one. Copied rather than committed: a second copy
// in the repository is a second thing to keep in step with the first, and this
// one cannot drift because it is written from the original every time.
copyFileSync(join(root, 'LICENSE'), join(crate, 'LICENSE'));

function build({ name, target, features }) {
	const outDir = join('pkg', name);
	// Always --no-default-features. Every build names exactly what it needs, so
	// a feature added to `default` later cannot quietly land in the binary a
	// visitor downloads — which is precisely how routing got there.
	const cargoArgs = ['--no-default-features'];
	if (features.length) cargoArgs.push('--features', features.join(','));

	console.log(`\n=== ${name} (target: ${target}, features: ${features.join(',') || 'minimal'})`);

	execFileSync(
		'wasm-pack',
		[
			'build',
			crate,
			'--release',
			'--target',
			target,
			'--out-dir',
			outDir,
			'--out-name',
			'i18n_fs_wasm',
			'--',
			...cargoArgs,
		],
		{ stdio: 'inherit', cwd: root, env: { ...process.env, I18N_FS_VERSION: VERSION } },
	);

	return join(crate, outDir);
}

function measure(dir) {
	const wasm = readdirSync(dir).find((file) => file.endsWith('.wasm'));
	if (!wasm) throw new Error(`no .wasm produced in ${dir}`);

	const path = join(dir, wasm);
	const bytes = readFileSync(path);
	return {
		raw: statSync(path).size,
		gzip: gzipSync(bytes, { level: 9 }).length,
	};
}

const kb = (bytes) => (bytes / 1024).toFixed(1);

rmSync(join(crate, 'pkg'), { recursive: true, force: true });
mkdirSync(join(crate, 'pkg'), { recursive: true });

const results = [];
for (const spec of BUILDS) {
	const dir = build(spec);
	results.push({ ...spec, ...measure(dir) });
}

console.log(`\n=== size report (i18n-fs ${VERSION})`);
let overBudget = false;
for (const result of results) {
	const over = result.gzip > result.budgetKb * 1024;
	overBudget ||= over;
	console.log(
		`${result.name.padEnd(8)} ${kb(result.raw).padStart(8)} KB raw` +
			`  ${kb(result.gzip).padStart(7)} KB gzip` +
			`  (budget ${result.budgetKb} KB)${over ? '  OVER BUDGET' : ''}`,
	);
}

if (overBudget) {
	console.error('\nA build exceeded its gzip budget. Move work out of it or raise the budget deliberately.');
	process.exit(1);
}

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
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crate = join(root, 'crates', 'i18n-fs-wasm');

/** @type {{name: string, target: string, features: string[], budgetKb: number}[]} */
const BUILDS = [
	{
		name: 'edge',
		target: 'bundler',
		features: [],
		// Measured baseline, not an aspiration. Breakdown at the time of writing:
		//   wasm-bindgen glue alone .................  6.3 KB gzip
		//   + serde-wasm-bindgen config bridging .... 32.7 KB gzip
		//   + locale negotiation and routing ........ 60.4 KB gzip
		// Roughly half the binary is the serde bridge, not our logic. Replacing the
		// serialised-config argument with primitive arguments would remove most of
		// it; see docs/adr/0001-wasm-boundary.md. The budget guards against drift
		// until that lands.
		budgetKb: 65,
	},
	{ name: 'browser', target: 'web', features: ['full'], budgetKb: 90 },
	{ name: 'node', target: 'nodejs', features: ['full'], budgetKb: 90 },
];

function build({ name, target, features }) {
	const outDir = join('pkg', name);
	const cargoArgs = features.length
		? ['--features', features.join(',')]
		: ['--no-default-features'];

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
		{ stdio: 'inherit', cwd: root },
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

console.log('\n=== size report');
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

/**
 * What each import actually costs.
 *
 * The promise this package makes about size is not "the binary is small" — it
 * is that you pay for what you use. A page that navigates but never translates
 * on the client should carry no WebAssembly at all, and a page that reads
 * `useLocale` should not drag in the message resolver.
 *
 * That holds today because `sideEffects: false` is declared and honoured. It is
 * one line, and nothing else in the repository would notice if it were removed
 * or if some module grew a top-level import of the core — the symptom is a
 * bigger download, which no type checker and no runtime test can see. So the
 * cost of a single import is measured here.
 *
 * Bundled with esbuild rather than webpack or Turbopack: it is the tool already
 * in the tree, and every bundler that honours `sideEffects` reaches the same
 * conclusion. The real-bundler version of this check is the example apps, one
 * of which ships no `.wasm` at all.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

/**
 * Bundle a single named import and return the result.
 *
 * The symbol is assigned to a global so nothing can be dropped as unused — the
 * question is what comes with it, not whether it survives on its own.
 */
function bundle(entry: string, symbol: string): { kb: number; code: string } {
	// esbuild's own API rather than its executable. Spawning it meant guessing
	// where the binary lives, which worked on one platform and failed on CI —
	// and the failure arrived as "command failed" with the reason swallowed.
	const result = buildSync({
		stdin: {
			contents: `import { ${symbol} } from ${JSON.stringify(dist + entry)};\nglobalThis.__keep = ${symbol};\n`,
			resolveDir: dist,
			sourcefile: `probe-${symbol}.mjs`,
			loader: 'js',
		},
		bundle: true,
		format: 'esm',
		minify: true,
		platform: 'node',
		external: ['react', 'react-dom', 'next', 'next/*'],
		write: false,
		logLevel: 'silent',
	});

	const code = result.outputFiles[0]?.text ?? '';
	return { kb: Buffer.byteLength(code) / 1024, code };
}

/** Whether the compiled core came along. It is the only thing here worth kilobytes. */
const pullsTheCore = (code: string) => /wasmBytes|i18n_fs_wasm/.test(code);

describe('importing one thing costs one thing', () => {
	// Generous on purpose: this is a guard against a module growing a top-level
	// import of the core, which moves these from single digits to ~275 KB. It is
	// not a budget, and it should not fail because a message got longer.
	const CHEAP = 12;

	it.each([
		['index.js', 'ErrorCode'],
		['index.js', 'VERSION'],
		['index.js', 'defineConfig'],
		['config.js', 'CONFIG_DEFAULTS'],
		['proxy.js', 'RECOMMENDED_MATCHER'],
	])('%s → %s stays small and core-free', (entry, symbol) => {
		const { kb, code } = bundle(entry, symbol);

		expect(pullsTheCore(code), `${symbol} should not pull the compiled core`).toBe(false);
		expect(kb, `${symbol} bundled to ${kb.toFixed(1)} KB`).toBeLessThan(CHEAP);
	});

	it.each([
		['client/index.js', 'useLocale'],
		['client/index.js', 'useI18nContext'],
		['navigation.js', 'Link'],
		['navigation.js', 'usePathname'],
		['navigation.js', 'useRouter'],
		['navigation.js', 'useLocaleSwitcher'],
	])('%s → %s carries no WebAssembly', (entry, symbol) => {
		// The whole point of mirroring `addLocale`/`stripLocale` in TypeScript: a
		// page that navigates but never translates on the client downloads no
		// binary. `examples/` proves the same thing through a real Next.js build.
		const { kb, code } = bundle(entry, symbol);

		expect(pullsTheCore(code), `${symbol} should not pull the compiled core`).toBe(false);
		expect(kb, `${symbol} bundled to ${kb.toFixed(1)} KB`).toBeLessThan(CHEAP);
	});
});

describe('the things that need the core say so by their size', () => {
	// Stated as an expectation rather than left implicit, so that if one of these
	// ever became cheap it would be noticed and explained rather than assumed to
	// have always been so.
	it.each([
		['client/index.js', 'useTranslation'],
		['index.js', 'loadMessageCore'],
		['proxy.js', 'createI18nProxy'],
	])('%s → %s pulls the core, because resolving needs it', (entry, symbol) => {
		expect(pullsTheCore(bundle(entry, symbol).code)).toBe(true);
	});
});

describe('the declaration that makes this work', () => {
	it('marks the package free of side effects', () => {
		// Without it a bundler must assume every module might do something on
		// import and keeps them all. Everything measured above would grow to the
		// size of the whole package.
		const manifest = JSON.parse(
			readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
		) as { sideEffects?: unknown };

		expect(manifest.sideEffects).toBe(false);
	});
});

/**
 * Version reporting.
 *
 * `0.1.0` shipped with `coreVersion()` returning `0.0.0` — the Rust crate's
 * version, which is never published and never moves — while two doc comments
 * claimed the JavaScript asserted the two agreed. Nothing did. A diagnostic
 * that reports the wrong version is worse than no diagnostic, so these pin down
 * both halves: the number is the package's, and the assertion exists.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCore } from '../src/core/index.js';
import { VERSION } from '../src/version.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
	version: string;
};

describe('VERSION', () => {
	it('is the package version, not a placeholder', () => {
		expect(VERSION).toBe(manifest.version);
		expect(VERSION).not.toBe('0.0.0-unbuilt');
	});

	it('is a semver string', () => {
		expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
	});
});

describe('the compiled core', () => {
	it('reports the package version, not the crate version', async () => {
		// The crates stay at 0.0.0 forever; that number must never reach a user.
		const core = await loadCore();
		expect(core.coreVersion()).toBe(manifest.version);
	});

	it('agrees with the JavaScript half', async () => {
		// The assertion inside loadCore() would have thrown before reaching here,
		// so this documents the invariant as much as it checks it.
		const core = await loadCore();
		expect(core.coreVersion()).toBe(VERSION);
	});
});

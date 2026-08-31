/**
 * The error taxonomy.
 *
 * The codes are declared twice — once in Rust, once in TypeScript — because one
 * side has to cross the WebAssembly boundary and the other has to be importable
 * by an application. Two declarations can disagree, and the disagreement would
 * be silent: a `switch` would simply never take a branch. So the last group of
 * tests here checks the JavaScript list against what the compiled core actually
 * emits, rather than against itself.
 */

import { describe, expect, it } from 'vitest';
import { loadFullCore } from '../src/core/index.js';
import {
	ERROR_CODE_NAMES,
	ErrorCode,
	errorCodeName,
	isErrorCode,
	isLookupError,
	isNamespaceError,
} from '../src/errors.js';
import type { I18nErrorPayload } from '../src/core/types.js';

const core = await loadFullCore();

const MESSAGES = JSON.stringify({
	hero: { title: 'Welcome', bullets: ['a', 'b'], cta: { label: 'Go' } },
});

/** Provoke a failure and hand back the payload that crossed the boundary. */
function failure(run: () => unknown): I18nErrorPayload {
	try {
		run();
	} catch (error) {
		return error as I18nErrorPayload;
	}

	throw new Error('expected the lookup to fail');
}

describe('the codes are values, not just types', () => {
	it('can be imported and compared', () => {
		// The whole point: an application can switch on these without having to
		// spell a string correctly.
		expect(ErrorCode.KeyNotFound).toBe(201);
		expect(typeof ErrorCode.KeyNotFound).toBe('number');
	});

	it('is frozen, so nobody can redefine a code at runtime', () => {
		expect(Object.isFrozen(ErrorCode)).toBe(true);
	});

	it('names every code it defines', () => {
		for (const code of Object.values(ErrorCode)) {
			expect(errorCodeName(code), `code ${code}`).toMatch(/^[A-Z_]+$/);
		}
	});

	it('says so when a code is not one of ours', () => {
		expect(errorCodeName(999)).toBe('UNKNOWN_999');
		expect(isErrorCode(999)).toBe(false);
		expect(isErrorCode('KEY_NOT_FOUND')).toBe(false);
		expect(isErrorCode(ErrorCode.InvalidJson)).toBe(true);
	});
});

describe('the groups', () => {
	it('separate a namespace that could not be used from a lookup inside one', () => {
		// One missing file is a single problem to fix; a missing key is one
		// problem per key. Acting on them differently is the point of the split.
		expect(isNamespaceError(ErrorCode.NamespaceNotFound)).toBe(true);
		expect(isNamespaceError(ErrorCode.InvalidJson)).toBe(true);
		expect(isNamespaceError(ErrorCode.KeyNotFound)).toBe(false);

		expect(isLookupError(ErrorCode.ScopeNotFound)).toBe(true);
		expect(isLookupError(ErrorCode.KeyNotFound)).toBe(true);
		expect(isLookupError(ErrorCode.TypeMismatch)).toBe(true);
		expect(isLookupError(ErrorCode.NamespaceNotFound)).toBe(false);
	});

	it('put every defined code in exactly one group range', () => {
		for (const code of Object.values(ErrorCode)) {
			expect(code, `code ${code}`).toBeGreaterThanOrEqual(100);
			expect(code, `code ${code}`).toBeLessThan(500);
		}
	});
});

describe('what the compiled core actually emits', () => {
	const store = new core.Store('fa', 'home', MESSAGES);

	it('numbers, not strings', () => {
		const payload = failure(() => store.resolveText('hero', 'nope'));

		expect(typeof payload.code).toBe('number');
		expect(payload.code).toBe(ErrorCode.KeyNotFound);
	});

	it('agrees with the JavaScript on every code it can produce', () => {
		// Each of these is provoked for real rather than asserted from a table,
		// so a renumbering on either side fails here.
		expect(failure(() => store.resolveText('nope', 'title')).code).toBe(ErrorCode.ScopeNotFound);
		expect(failure(() => store.resolveText('hero', 'nope')).code).toBe(ErrorCode.KeyNotFound);
		expect(failure(() => store.resolveText('hero', 'bullets')).code).toBe(ErrorCode.TypeMismatch);
		expect(failure(() => store.resolveList('hero', 'title')).code).toBe(ErrorCode.TypeMismatch);
		expect(failure(() => new core.Store('fa', 'broken', '{ oops')).code).toBe(
			ErrorCode.InvalidJson,
		);
	});

	it('uses the same code for an invalid configuration', () => {
		const [issue] = core.validateConfig({
			locales: ['fa'],
			defaultLocale: 'de',
			strategy: 'path',
			prefix: 'as-needed',
			domains: [],
			cookie: { name: 'X', maxAge: 1, sameSite: 'lax', path: '/', secure: true },
			messagesDir: 'locales',
			debug: false,
		});

		expect(issue?.code).toBe(ErrorCode.InvalidConfig);
	});

	it('defines exactly the codes the JavaScript names, and no more', () => {
		// A code the core can emit but the JavaScript cannot name would print as
		// UNKNOWN_n to whoever hit it.
		const named = Object.values(ErrorCode).sort((a, b) => a - b);
		expect(named).toEqual([100, 101, 200, 201, 202, 300, 301, 302, 400]);
		expect(Object.keys(ERROR_CODE_NAMES)).toHaveLength(named.length);
	});
});

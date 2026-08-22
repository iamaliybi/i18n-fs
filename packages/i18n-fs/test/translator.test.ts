/**
 * The shared translator.
 *
 * These cover the behaviour the server layer and the client hook both inherit:
 * one fallback rule, distinct diagnosis, and no cross-language substitution
 * anywhere.
 */

import { describe, expect, it, vi } from 'vitest';
import { loadFullCore } from '../src/core/index.js';
import { createReporter, formatError } from '../src/report.js';
import { createTranslator, type NamespaceState } from '../src/translator.js';

const core = await loadFullCore();

const MESSAGES = JSON.stringify({
	title: 'Welcome',
	greeting: 'Hello {name}, you have {count} messages',
	terms: 'Please read the <link>terms</link> before you <b>continue</b>',
	bullets: ['First {name}', 'Second'],
	nested: { label: 'Inner', deep: { value: 'Deepest' } },
});

function ready(raw = MESSAGES): NamespaceState {
	return { status: 'ready', store: new core.Store('fa', 'home', raw) };
}

const failed: NamespaceState = {
	status: 'failed',
	error: {
		code: 'NAMESPACE_NOT_FOUND',
		locale: 'fa',
		namespace: 'home',
		scope: null,
		key: null,
		detail: 'ENOENT',
	},
};

function translator(state: NamespaceState = ready(), scope?: string) {
	const logged: string[] = [];
	const report = createReporter(true, (message) => logged.push(message));

	const t = createTranslator({
		core,
		locale: 'fa',
		namespace: 'home',
		scope,
		state,
		report,
	});

	return { t, logged };
}

describe('plain messages', () => {
	it('resolves a key', () => {
		const { t } = translator();
		expect(t('title')).toBe('Welcome');
	});

	it('resolves a key inside a scope', () => {
		const { t } = translator(ready(), 'nested');
		expect(t('label')).toBe('Inner');
		expect(t('deep.value')).toBe('Deepest');
	});

	it('substitutes parameters, including numbers', () => {
		const { t } = translator();
		expect(t('greeting', { name: 'Ali', count: 3 })).toBe('Hello Ali, you have 3 messages');
	});
});

describe('fallback', () => {
	it('returns the key when the lookup fails', () => {
		const { t } = translator();
		expect(t('nope')).toBe('nope');
	});

	it('returns the developer string when one is given', () => {
		const { t } = translator();
		expect(t('nope', {}, { fallback: 'Get started' })).toBe('Get started');
	});

	it('falls back the same way whatever went wrong', () => {
		// The point of the rule: one behaviour, five reasons.
		const missingFile = translator(failed).t;
		const badJson = translator({
			status: 'failed',
			error: {
				code: 'INVALID_JSON',
				locale: 'fa',
				namespace: 'home',
				scope: null,
				key: null,
				detail: 'expected value at line 1',
			},
		}).t;
		const missingKey = translator().t;
		const wrongShape = translator().t;

		expect(missingFile('x', {}, { fallback: 'F' })).toBe('F');
		expect(badJson('x', {}, { fallback: 'F' })).toBe('F');
		expect(missingKey('nope', {}, { fallback: 'F' })).toBe('F');
		expect(wrongShape('nested', {}, { fallback: 'F' })).toBe('F');
	});

	it('never substitutes another locale', () => {
		// There is no mechanism for it: the translator is handed one store, for
		// one locale, and has nowhere else to look. This pins that down.
		const { t } = translator();
		expect(t('nope')).toBe('nope');
		expect(t('nope')).not.toBe('Welcome');
	});
});

describe('diagnostics', () => {
	it('reports a missing key as KEY_NOT_FOUND', () => {
		const { t, logged } = translator();
		t('nope');

		expect(logged).toHaveLength(1);
		expect(logged[0]).toContain('KEY_NOT_FOUND');
		expect(logged[0]).toContain('nope');
	});

	it('reports a missing file as NAMESPACE_NOT_FOUND, with the reason', () => {
		const { t, logged } = translator(failed);
		t('title');

		expect(logged[0]).toContain('NAMESPACE_NOT_FOUND');
		expect(logged[0]).toContain('ENOENT');
	});

	it('reports a missing scope separately from a missing key', () => {
		const { t: missingScope, logged: scopeLog } = translator(ready(), 'nope');
		missingScope('label');
		expect(scopeLog[0]).toContain('SCOPE_NOT_FOUND');

		const { t: missingKey, logged: keyLog } = translator(ready(), 'nested');
		missingKey('nope');
		expect(keyLog[0]).toContain('KEY_NOT_FOUND');
	});

	it('reports the wrong shape as TYPE_MISMATCH', () => {
		const { t, logged } = translator();
		t('bullets');
		expect(logged[0]).toContain('TYPE_MISMATCH');
	});

	it('reports a missing parameter and leaves the marker visible', () => {
		const { t, logged } = translator();

		expect(t('greeting', { name: 'Ali' })).toBe('Hello Ali, you have {count} messages');
		expect(logged[0]).toContain('PARAM_MISSING');
		expect(logged[0]).toContain('{count}');
	});

	it('logs each distinct problem once, however often it is asked', () => {
		const { t, logged } = translator();

		for (let i = 0; i < 50; i += 1) t('nope');
		t('also-nope');

		expect(logged).toHaveLength(2);
	});

	it('says nothing outside debug mode', () => {
		const sink = vi.fn();
		const report = createReporter(false, sink);

		const t = createTranslator({
			core,
			locale: 'fa',
			namespace: 'home',
			state: ready(),
			report,
		});

		expect(t('nope')).toBe('nope');
		expect(sink).not.toHaveBeenCalled();
	});

	it('names the locale and namespace so the file can be found', () => {
		expect(
			formatError({
				code: 'KEY_NOT_FOUND',
				locale: 'fa',
				namespace: 'home/hero',
				scope: 'cta',
				key: 'label',
				detail: null,
			}),
		).toBe('[i18n-fs] KEY_NOT_FOUND: key "cta.label" does not exist in "home/hero" for locale "fa".');
	});
});

describe('lists', () => {
	it('resolves and interpolates each element', () => {
		const { t } = translator();
		expect(t.array('bullets', { name: 'Ali' })).toEqual(['First Ali', 'Second']);
	});

	it('falls back to a single-element list', () => {
		const { t } = translator();
		expect(t.array('nope')).toEqual(['nope']);
		expect(t.array('nope', {}, { fallback: 'None' })).toEqual(['None']);
	});

	it('reports asking a string for a list', () => {
		const { t, logged } = translator();
		expect(t.array('title')).toEqual(['title']);
		expect(logged[0]).toContain('TYPE_MISMATCH');
	});
});

describe('has and raw', () => {
	it('has reports presence without logging', () => {
		const { t, logged } = translator();

		expect(t.has('title')).toBe(true);
		expect(t.has('bullets')).toBe(true);
		expect(t.has('nested')).toBe(false);
		expect(t.has('nope')).toBe(false);
		expect(logged).toEqual([]);
	});

	it('raw returns the stored value with no interpolation', () => {
		const { t, logged } = translator();

		expect(t.raw('greeting')).toBe('Hello {name}, you have {count} messages');
		expect(t.raw('bullets')).toEqual(['First {name}', 'Second']);
		expect(t.raw('nope')).toBeUndefined();
		expect(logged).toEqual([]);
	});

	it('has is false when the namespace never loaded', () => {
		const { t } = translator(failed);
		expect(t.has('title')).toBe(false);
		expect(t.raw('title')).toBeUndefined();
	});
});

/**
 * End-to-end smoke test of the Rust -> WASM -> JavaScript boundary.
 *
 * The Rust behaviour itself is covered by the cargo suite. What this file
 * proves is the part cargo cannot see: that the compiled binary loads, that
 * serde's field renaming and the TypeScript types agree, and that errors cross
 * the boundary as structured objects rather than opaque strings.
 */

import { describe, expect, it } from 'vitest';
import { loadFullCore, loadRouter } from '../src/core/index.js';
import { ErrorCode } from '../src/errors.js';
import type { I18nErrorPayload, ResolvedI18nFsConfig } from '../src/index.js';
import { CONFIG_DEFAULTS } from '../src/config.js';

const config: ResolvedI18nFsConfig = {
	locales: ['fa', 'en'],
	defaultLocale: 'fa',
	strategy: 'path',
	prefix: 'as-needed',
	domains: [],
	cookie: { ...CONFIG_DEFAULTS.cookie },
	messagesDir: 'locales',
	compareLocales: true,
	debug: true,
};

const core = await loadFullCore();

// The same handle the proxy builds: the configuration crosses the WebAssembly
// boundary once, at startup, rather than being serialised into every call.
const router = await loadRouter(config);

describe('core loading', () => {
	it('reports the version of the compiled binary', () => {
		expect(core.coreVersion()).toMatch(/^\d+\.\d+\.\d+$/);
	});
});

describe('configuration', () => {
	it('accepts a valid snapshot', () => {
		expect(core.validateConfig(config)).toEqual([]);
	});

	it('reports problems with the field path that caused them', () => {
		const issues = core.validateConfig({ ...config, defaultLocale: 'de' });
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			code: ErrorCode.InvalidConfig,
			field: 'defaultLocale',
		});
	});
});

describe('locale negotiation', () => {
	it('picks the best supported locale', () => {
		expect(router.negotiateLocale('en-US,en;q=0.9')).toBe('en');
	});

	it('falls back to the default when nothing matches', () => {
		expect(router.negotiateLocale('ja')).toBe('fa');
	});

	it('handles a missing header', () => {
		expect(router.negotiateLocale()).toBe('fa');
	});
});

describe('routing', () => {
	it('rewrites the unprefixed default locale', () => {
		const decision = router.decideRoute('/about');

		expect(decision.locale).toBe('fa');
		expect(decision.action).toBe('rewrite');
		expect(decision.path).toBe('/fa/about');
		expect(decision.setCookie).toBe(true);
		expect(decision.source).toBe('default');
	});

	it('passes a correctly prefixed URL through', () => {
		const decision = router.decideRoute('/en/about', undefined, 'en');

		expect(decision.action).toBe('next');
		expect(decision.source).toBe('path');
	});

	it('redirects a redundant default prefix, permanently', () => {
		const decision = router.decideRoute('/fa/about');

		expect(decision.action).toBe('redirect');
		expect(decision.path).toBe('/about');
		expect(decision.permanent).toBe(true);
	});

	it('does not touch framework and asset paths', () => {
		for (const pathname of ['/_next/static/x.js', '/api/users', '/logo.png']) {
			expect(router.decideRoute(pathname).action, pathname).toBe('next');
		}
	});

	it('canonicalises a path for the navigation wrappers', () => {
		expect(router.canonicalPath('/fa/about', 'en')).toBe('/en/about');
		expect(router.internalPath('/about', 'en')).toBe('/en/about');
	});
});

describe('message store', () => {
	const raw = JSON.stringify({
		hero: {
			title: 'Welcome',
			bullets: ['Fast', 'Small'],
			cta: { label: 'Start' },
		},
	});

	it('resolves a key inside a scope', () => {
		const store = new core.Store('fa', 'home', raw);
		expect(store.resolveText('hero', 'title')).toBe('Welcome');
		expect(store.resolveList('hero', 'bullets')).toEqual(['Fast', 'Small']);
		store.free();
	});

	it('throws a structured error naming the exact reason', () => {
		const store = new core.Store('fa', 'home', raw);

		expect.assertions(4);
		try {
			store.resolveText('hero', 'missing');
		} catch (error) {
			const payload = error as I18nErrorPayload;
			expect(payload.code).toBe(ErrorCode.KeyNotFound);
			expect(payload.locale).toBe('fa');
			expect(payload.namespace).toBe('home');
			expect(payload.key).toBe('missing');
		} finally {
			store.free();
		}
	});

	it('distinguishes a missing scope from a missing key', () => {
		const store = new core.Store('fa', 'home', raw);
		try {
			expect(() => store.resolveText('nope', 'title')).toThrowError(
				expect.objectContaining({ code: ErrorCode.ScopeNotFound }),
			);
			expect(() => store.resolveText('hero', 'cta')).toThrowError(
				expect.objectContaining({ code: ErrorCode.TypeMismatch }),
			);
		} finally {
			store.free();
		}
	});

	it('distinguishes invalid JSON from a missing key', () => {
		expect(() => new core.Store('fa', 'broken', '{ oops')).toThrowError(
			expect.objectContaining({ code: ErrorCode.InvalidJson }),
		);
	});
});

describe('formatting', () => {
	it('substitutes parameters and reports the missing ones', () => {
		expect(core.interpolate('Hello {name}', { name: 'Ali' })).toEqual({
			value: 'Hello Ali',
			missing: [],
			notNumeric: [],
			unmatched: [],
		});

		expect(core.interpolate('Hello {name}', {})).toEqual({
			value: 'Hello {name}',
			missing: ['name'],
			notNumeric: [],
			unmatched: [],
		});
	});

	it('returns a node tree rather than markup, so JSX never crosses the boundary', () => {
		expect(core.tokenize('Hi <b>{name}</b>')).toEqual([
			{ type: 'text', value: 'Hi ' },
			{
				type: 'tag',
				name: 'b',
				children: [{ type: 'param', name: 'name' }],
			},
		]);
	});

	it('parses tags nested inside a tag of the same name', () => {
		expect(core.tokenize('<b>a<b>c</b></b>')).toEqual([
			{
				type: 'tag',
				name: 'b',
				children: [
					{ type: 'text', value: 'a' },
					{ type: 'tag', name: 'b', children: [{ type: 'text', value: 'c' }] },
				],
			},
		]);
	});
});

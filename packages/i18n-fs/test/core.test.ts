/**
 * End-to-end smoke test of the Rust -> WASM -> JavaScript boundary.
 *
 * The Rust behaviour itself is covered by the cargo suite. What this file
 * proves is the part cargo cannot see: that the compiled binary loads, that
 * serde's field renaming and the TypeScript types agree, and that errors cross
 * the boundary as structured objects rather than opaque strings.
 */

import { describe, expect, it } from 'vitest';
import { loadFullCore } from '../src/core/index.js';
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
	debug: true,
};

const core = await loadFullCore();

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
			code: 'INVALID_CONFIG',
			field: 'defaultLocale',
		});
	});
});

describe('locale negotiation', () => {
	it('picks the best supported locale', () => {
		expect(core.negotiateLocale(config, 'en-US,en;q=0.9')).toBe('en');
	});

	it('falls back to the default when nothing matches', () => {
		expect(core.negotiateLocale(config, 'ja')).toBe('fa');
	});

	it('handles a missing header', () => {
		expect(core.negotiateLocale(config)).toBe('fa');
	});
});

describe('routing', () => {
	it('rewrites the unprefixed default locale', () => {
		const decision = core.decideRoute(config, { pathname: '/about' });
		expect(decision).toEqual({
			locale: 'fa',
			action: { type: 'rewrite', path: '/fa/about' },
			setCookie: true,
			source: 'default',
		});
	});

	it('passes a correctly prefixed URL through', () => {
		const decision = core.decideRoute(config, {
			pathname: '/en/about',
			cookieLocale: 'en',
		});
		expect(decision.action).toEqual({ type: 'next' });
		expect(decision.source).toBe('path');
	});

	it('redirects a redundant default prefix, permanently', () => {
		const decision = core.decideRoute(config, { pathname: '/fa/about' });
		expect(decision.action).toEqual({
			type: 'redirect',
			path: '/about',
			permanent: true,
		});
	});

	it('does not touch framework and asset paths', () => {
		for (const pathname of ['/_next/static/x.js', '/api/users', '/logo.png']) {
			expect(core.decideRoute(config, { pathname }).action).toEqual({ type: 'next' });
		}
	});

	it('canonicalises a path for the navigation wrappers', () => {
		expect(core.canonicalPath(config, '/fa/about', 'en')).toBe('/en/about');
		expect(core.internalPath(config, '/about', 'en')).toBe('/en/about');
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
			expect(payload.code).toBe('KEY_NOT_FOUND');
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
				expect.objectContaining({ code: 'SCOPE_NOT_FOUND' }),
			);
			expect(() => store.resolveText('hero', 'cta')).toThrowError(
				expect.objectContaining({ code: 'TYPE_MISMATCH' }),
			);
		} finally {
			store.free();
		}
	});

	it('distinguishes invalid JSON from a missing key', () => {
		expect(() => new core.Store('fa', 'broken', '{ oops')).toThrowError(
			expect.objectContaining({ code: 'INVALID_JSON' }),
		);
	});
});

describe('formatting', () => {
	it('substitutes parameters and reports the missing ones', () => {
		expect(core.interpolate('Hello {name}', { name: 'Ali' })).toEqual({
			value: 'Hello Ali',
			missing: [],
		});

		expect(core.interpolate('Hello {name}', {})).toEqual({
			value: 'Hello {name}',
			missing: ['name'],
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

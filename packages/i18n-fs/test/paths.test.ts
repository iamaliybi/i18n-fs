/**
 * The TypeScript path helpers, checked against the Rust core.
 *
 * `src/paths.ts` mirrors two small pieces of `i18n_fs_core::routing` so that
 * `<Link>` can stay synchronous. A mirror that drifts is worse than no mirror:
 * links would point somewhere the middleware then redirects away from. So
 * rather than testing the copy against hand-written expectations, it is tested
 * against the original, over the whole cross-product of configurations and the
 * path shapes that break naive implementations.
 */

import { describe, expect, it } from 'vitest';
import type { PrefixMode, ResolvedI18nFsConfig, RoutingStrategy } from '../src/config.js';
import { loadFullCore, loadRouter } from '../src/core/index.js';
import { addLocale, baseLocale, localePath, stripLocale } from '../src/paths.js';

const core = await loadFullCore();

const LOCALES = ['fa', 'en', 'de-AT'];

function config(strategy: RoutingStrategy, prefix: PrefixMode, defaultLocale: string) {
	return {
		locales: LOCALES,
		defaultLocale,
		strategy,
		prefix,
		domains: [
			{ domain: 'example.ir', locale: 'fa', locales: [] },
			{ domain: 'example.com', locale: 'en', locales: ['de-AT'] },
		],
		cookie: { name: 'I18N_FS_LOCALE', maxAge: 1, sameSite: 'lax' as const, path: '/', secure: true },
		messagesDir: 'locales',
		compareLocales: true,
		debug: false,
	} satisfies ResolvedI18nFsConfig;
}

const STRATEGIES: RoutingStrategy[] = ['path', 'domain', 'cookie'];
const PREFIXES: PrefixMode[] = ['always', 'as-needed', 'never'];
const HOSTS = [undefined, 'example.ir', 'example.com', 'localhost:3000'];

/** The shapes that break naive implementations, plus ordinary ones. */
const PATHS = [
	'/',
	'/about',
	'/fa',
	'/en/about',
	'/fa/fa/about',
	'/fa/en/about',
	'/de-AT/docs/getting-started',
	'//en//about',
	'/en/about/',
	'/blog/fa',
	'/en-US/about',
];

describe('the mirror agrees with the core', () => {
	it('produces the same canonical path for every configuration', async () => {
		let checked = 0;

		for (const strategy of STRATEGIES) {
			for (const prefix of PREFIXES) {
				for (const defaultLocale of LOCALES) {
					const cfg = config(strategy, prefix, defaultLocale);
					// One router per configuration, the same handle the proxy
					// builds — so the mirror is checked against what actually runs.
					const router = await loadRouter(cfg);

					for (const host of HOSTS) {
						const base = baseLocale(cfg, host);

						for (const path of PATHS) {
							for (const locale of LOCALES) {
								const mine = addLocale(cfg, stripLocale(cfg, path), locale, base);
								const theirs = router.canonicalPath(path, locale, host);

								expect(
									mine,
									`${strategy}/${prefix}/default=${defaultLocale} host=${host} ` +
										`path=${path} locale=${locale}`,
								).toBe(theirs);

								checked += 1;
							}
						}
					}
				}
			}
		}

		// Guard against the loops silently collapsing to nothing.
		expect(checked).toBeGreaterThan(3000);
	});

	it('strips locale prefixes the same way', async () => {
		const cfg = config('path', 'never', 'fa');
		const router = await loadRouter(cfg);

		for (const path of PATHS) {
			// `never` means the canonical form is the stripped one, so the core's
			// canonical path is exactly what `stripLocale` should produce.
			expect(stripLocale(cfg, path)).toBe(router.canonicalPath(path, 'fa', undefined));
		}
	});
});

describe('localePath', () => {
	const cfg = config('path', 'as-needed', 'fa');

	it('adds the prefix for a non-default locale', () => {
		expect(localePath(cfg, '/about', 'en')).toBe('/en/about');
	});

	it('leaves the default locale unprefixed', () => {
		expect(localePath(cfg, '/about', 'fa')).toBe('/about');
	});

	it('replaces a prefix already present, so it is idempotent', () => {
		expect(localePath(cfg, '/en/about', 'en')).toBe('/en/about');
		expect(localePath(cfg, '/fa/about', 'en')).toBe('/en/about');
		expect(localePath(cfg, localePath(cfg, '/about', 'en'), 'en')).toBe('/en/about');
	});

	it('keeps the query and the fragment', () => {
		expect(localePath(cfg, '/about?a=1&b=2#top', 'en')).toBe('/en/about?a=1&b=2#top');
		expect(localePath(cfg, '/about#top', 'en')).toBe('/en/about#top');
	});

	it('leaves anything that is not one of our paths alone', () => {
		for (const href of [
			'https://example.com/about',
			'mailto:a@b.c',
			'#section',
			'tel:+1',
			'about',
		]) {
			expect(localePath(cfg, href, 'en')).toBe(href);
		}
	});

	it('is relative to the domain locale under the domain strategy', () => {
		const domain = config('domain', 'as-needed', 'fa');

		// On the English host, English is what goes unprefixed — not the global
		// default. Getting this wrong is what caused a redirect loop before.
		expect(localePath(domain, '/about', 'en', 'example.com')).toBe('/about');
		expect(localePath(domain, '/about', 'fa', 'example.com')).toBe('/fa/about');
		expect(localePath(domain, '/about', 'fa', 'example.ir')).toBe('/about');
	});
});

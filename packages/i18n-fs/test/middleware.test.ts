/**
 * The middleware, exercised through real `NextRequest` objects.
 *
 * The routing decisions themselves are the core's, proven by property test.
 * What is tested here is the translation of a decision into a `NextResponse`:
 * the right status, the right headers reaching the server layer, and the cookie
 * written exactly when the decision says so.
 *
 * The end-to-end suite in `examples/next-app-router` covers the same ground
 * through a running server; this covers the branches that are awkward to reach
 * that way.
 */

import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import type { ResolvedI18nFsConfig } from '../src/config.js';
import {
	createI18nMiddleware,
	createI18nProxy,
	LOCALE_HEADER,
	RECOMMENDED_MATCHER,
	RESOLVED_HEADER,
} from '../src/middleware.js';

const CONFIG: ResolvedI18nFsConfig = {
	locales: ['fa', 'en'],
	defaultLocale: 'fa',
	strategy: 'path',
	prefix: 'as-needed',
	domains: [],
	cookie: { name: 'I18N_FS_LOCALE', maxAge: 3600, sameSite: 'lax', path: '/', secure: true },
	messagesDir: 'locales',
	debug: false,
};

const middleware = createI18nProxy(CONFIG);

function request(path: string, headers: Record<string, string> = {}): NextRequest {
	return new NextRequest(new URL(path, 'https://example.com'), { headers });
}

/** Where a rewrite or redirect points, as a pathname. */
function target(response: NextResponse): string | undefined {
	const location = response.headers.get('location') ?? response.headers.get('x-middleware-rewrite');
	return location ? new URL(location, 'https://example.com').pathname : undefined;
}

describe('decisions become responses', () => {
	it('rewrites the unprefixed default locale', async () => {
		const response = await middleware(request('/about'));

		expect(response.status).toBe(200);
		expect(target(response)).toBe('/fa/about');
		expect(response.headers.get(LOCALE_HEADER)).toBe('fa');
	});

	it('passes a correctly prefixed URL through', async () => {
		const response = await middleware(request('/en/about', { cookie: 'I18N_FS_LOCALE=en' }));

		expect(response.headers.get('location')).toBeNull();
		expect(response.headers.get('x-middleware-rewrite')).toBeNull();
		expect(response.headers.get(LOCALE_HEADER)).toBe('en');
	});

	it('redirects a redundant default prefix permanently', async () => {
		const response = await middleware(request('/fa/about'));

		expect(response.status).toBe(308);
		expect(target(response)).toBe('/about');
	});

	it('redirects a negotiated locale temporarily', async () => {
		// This one depends on the visitor's headers, so it must never be cached
		// as permanent.
		const response = await middleware(request('/about', { 'accept-language': 'en' }));

		expect(response.status).toBe(307);
		expect(target(response)).toBe('/en/about');
	});

	it('preserves the query string across a redirect', async () => {
		const response = await middleware(request('/fa/about?page=2'));
		const location = new URL(response.headers.get('location')!, 'https://example.com');

		expect(location.pathname).toBe('/about');
		expect(location.search).toBe('?page=2');
	});
});

describe('what reaches the server layer', () => {
	it('forwards the resolved locale as a request header', async () => {
		const response = await middleware(request('/en/about'));
		const forwarded = response.headers.get('x-middleware-request-' + LOCALE_HEADER);

		// Next encodes overridden request headers on the response; either shape
		// is acceptable, but the locale has to be in one of them.
		expect(forwarded ?? response.headers.get(LOCALE_HEADER)).toBe('en');
	});

	it('marks the request as resolved so a second pass cannot loop', async () => {
		const first = await middleware(request('/about'));
		expect(target(first)).toBe('/fa/about');

		// A request that says it has already been through cannot be redirected,
		// whatever its shape.
		const second = await middleware(request('/fa/about', { [RESOLVED_HEADER]: '1' }));
		expect(second.headers.get('location')).toBeNull();
	});
});

describe('the cookie', () => {
	it('is written when the resolved locale is new', async () => {
		const response = await middleware(request('/en/about'));
		const cookie = response.cookies.get('I18N_FS_LOCALE');

		expect(cookie?.value).toBe('en');
		expect(cookie?.maxAge).toBe(3600);
		expect(cookie?.sameSite).toBe('lax');
	});

	it('is left alone when it already matches', async () => {
		const response = await middleware(request('/en/about', { cookie: 'I18N_FS_LOCALE=en' }));
		expect(response.cookies.get('I18N_FS_LOCALE')).toBeUndefined();
	});

	it('is readable by client script, so the switcher can write it too', async () => {
		const response = await middleware(request('/en/about'));
		expect(response.cookies.get('I18N_FS_LOCALE')?.httpOnly).toBe(false);
	});
});

describe('paths the middleware must not touch', () => {
	it('passes assets and framework paths through without a cookie', async () => {
		for (const path of ['/_next/static/x.js', '/api/users', '/logo.png']) {
			const response = await middleware(request(path));

			expect(response.headers.get('location'), path).toBeNull();
			expect(response.cookies.get('I18N_FS_LOCALE'), path).toBeUndefined();
		}
	});

	it('recommends a matcher that excludes them', () => {
		const matcher = new RegExp(`^${RECOMMENDED_MATCHER}$`);

		expect(matcher.test('/about')).toBe(true);
		expect(matcher.test('/')).toBe(true);
		expect(matcher.test('/_next/static/x.js')).toBe(false);
		expect(matcher.test('/api/users')).toBe(false);
		expect(matcher.test('/logo.png')).toBe(false);
		expect(matcher.test('/locales/fa/common.json')).toBe(false);
	});
});

describe('composition', () => {
	it('lets a caller short-circuit before the locale is resolved', async () => {
		const guarded = createI18nProxy(CONFIG, {
			before: (incoming) =>
				incoming.nextUrl.pathname.startsWith('/admin')
					? NextResponse.redirect(new URL('/login', incoming.url))
					: undefined,
		});

		const blocked = await guarded(request('/admin/secret'));
		expect(target(blocked)).toBe('/login');

		const normal = await guarded(request('/about'));
		expect(target(normal)).toBe('/fa/about');
	});
});

describe('the middleware name', () => {
	it('is still exported, because Next.js 14 and 15 use that file convention', () => {
		// Next.js 16 renamed the convention to `proxy` and deprecated
		// `middleware`. Upgrading Next should not force an application to rename
		// its import at the same moment it renames its file.
		expect(createI18nMiddleware).toBe(createI18nProxy);
	});
});

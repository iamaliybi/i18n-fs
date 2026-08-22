/**
 * The locale-resolving middleware.
 *
 * ```ts
 * // middleware.ts
 * import { createI18nMiddleware } from 'i18n-fs/middleware';
 * import i18nConfig from './.i18n-fs/config.mjs';
 *
 * export default createI18nMiddleware(i18nConfig);
 *
 * export const config = {
 *   matcher: ['/((?!_next/|api/|.*\.[^/]*$).*)'],
 * };
 * ```
 *
 * The matcher has to be written out literally. Next.js reads it by static
 * analysis at build time and rejects an imported identifier, so this package
 * cannot hand you a constant for it however much it would like to.
 *
 * The configuration is passed in rather than discovered. The Edge runtime has
 * no filesystem, so the app has to import the generated snapshot itself — and
 * a static import is better anyway: the bundler can see it.
 *
 * Every decision comes from `decideRoute` in the Rust core, which is where the
 * loop guarantee is proven ([ADR 0004]). This file only turns the decision into
 * a `NextResponse`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import type { ResolvedI18nFsConfig } from './config.js';
import { loadCore } from './core/index.js';
import type { Decision } from './core/types.js';

/** Header carrying the resolved locale to the server layer. */
export const LOCALE_HEADER = 'x-i18n-fs-locale';

/**
 * Header marking a request a previous pass already resolved.
 *
 * The last-resort loop breaker. Nothing in the routing logic depends on it —
 * `decideRoute` is idempotent — but it is what still stops a loop if that ever
 * stops being true.
 */
export const RESOLVED_HEADER = 'x-i18n-fs-resolved';

/**
 * The matcher pattern to copy into `middleware.ts`.
 *
 * Exported for documentation and tests only — Next.js will not accept it as an
 * imported value, see the note at the top of this file. The core re-checks the
 * same paths in `should_handle`, so a mistake here cannot on its own produce a
 * redirect loop on a static asset.
 */
export const RECOMMENDED_MATCHER = '/((?!_next/|api/|.*\\.[^/]*$).*)';

/** Options for {@link createI18nMiddleware}. */
export interface I18nMiddlewareOptions {
	/**
	 * Run before the locale is resolved. Return a response to short-circuit.
	 *
	 * The escape hatch for composing with other middleware without asking
	 * people to reimplement this one.
	 */
	before?: (request: NextRequest) => NextResponse | undefined | Promise<NextResponse | undefined>;
}

/** Apply the decision's cookie, if it wants one. */
function applyCookie(
	response: NextResponse,
	config: ResolvedI18nFsConfig,
	decision: Decision,
): NextResponse {
	if (!decision.setCookie) return response;

	response.cookies.set(config.cookie.name, decision.locale, {
		maxAge: config.cookie.maxAge,
		sameSite: config.cookie.sameSite,
		path: config.cookie.path,
		secure: config.cookie.secure,
		httpOnly: false,
	});

	return response;
}

/** Request headers forwarded to the server layer. */
function forwardedHeaders(request: NextRequest, locale: string): Headers {
	const headers = new Headers(request.headers);
	headers.set(LOCALE_HEADER, locale);
	headers.set(RESOLVED_HEADER, '1');
	return headers;
}

/** Build the middleware for a configuration. */
export function createI18nMiddleware(
	config: ResolvedI18nFsConfig,
	options: I18nMiddlewareOptions = {},
) {
	return async function i18nMiddleware(request: NextRequest): Promise<NextResponse> {
		const early = await options.before?.(request);
		if (early) return early;

		const core = await loadCore();

		const decision = core.decideRoute(config, {
			pathname: request.nextUrl.pathname,
			host: request.headers.get('host'),
			cookieLocale: request.cookies.get(config.cookie.name)?.value ?? null,
			acceptLanguage: request.headers.get('accept-language'),
			alreadyResolved: request.headers.has(RESOLVED_HEADER),
		});

		const headers = forwardedHeaders(request, decision.locale);
		let response: NextResponse;

		switch (decision.action.type) {
			case 'redirect': {
				const url = request.nextUrl.clone();
				url.pathname = decision.action.path;
				// Same origin, always: moving a visitor between locale domains is a
				// deliberate action, not something the middleware infers.
				response = NextResponse.redirect(url, decision.action.permanent ? 308 : 307);
				break;
			}

			case 'rewrite': {
				const url = request.nextUrl.clone();
				url.pathname = decision.action.path;
				response = NextResponse.rewrite(url, { request: { headers } });
				break;
			}

			case 'next':
				response = NextResponse.next({ request: { headers } });
				break;
		}

		// Echoed on the response too, so the resolved locale is visible in
		// devtools and to any downstream middleware.
		response.headers.set(LOCALE_HEADER, decision.locale);

		return applyCookie(response, config, decision);
	};
}

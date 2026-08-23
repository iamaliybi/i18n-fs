/**
 * The locale-resolving proxy.
 *
 * Next.js 16 renamed this file convention from `middleware` to `proxy`, and
 * deprecated the old name. Both still work; the factory is the same function
 * either way, because what changed is which filename Next looks for, not the
 * signature it expects.
 *
 * ```ts
 * // proxy.ts  (Next.js 16+)
 * import { createI18nProxy } from 'i18n-fs/proxy';
 * import i18nConfig from './.i18n-fs/config.mjs';
 *
 * export default createI18nProxy(i18nConfig);
 *
 * export const config = {
 *   matcher: ['/((?!_next/|api/|.*\.[^/]*$).*)'],
 * };
 * ```
 *
 * On Next.js 14 and 15 the file is `middleware.ts` and the factory is
 * `createI18nMiddleware`, which is the same function under its older name.
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

/** Options for {@link createI18nProxy}. */
export interface I18nProxyOptions {
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

/**
 * What {@link createI18nProxy} returns.
 *
 * Named rather than inferred on purpose. An inferred return type makes the
 * application's `export default` reference `NextResponse` through *this
 * package's* copy of the Next.js types, and TypeScript then refuses it with
 * "The inferred type of 'default' cannot be named without a reference to
 * .../node_modules/next/server. This is likely not portable." Naming the type
 * here gives the declaration something local to point at.
 */
export type I18nProxyHandler = (request: NextRequest) => Promise<NextResponse>;

/**
 * Build the proxy handler for a configuration.
 *
 * Export the result as the default export of `proxy.ts` (Next.js 16+) or
 * `middleware.ts` (Next.js 14 and 15).
 */
export function createI18nProxy(
	config: ResolvedI18nFsConfig,
	options: I18nProxyOptions = {},
): I18nProxyHandler {
	return async function i18nProxy(request: NextRequest): Promise<NextResponse> {
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

/**
 * The former name of {@link createI18nProxy}.
 *
 * @deprecated Next.js 16 renamed the file convention to `proxy`; rename the
 * import along with the file. This alias is the identical function and is kept
 * so upgrading Next.js does not force an application to change two things at
 * once.
 */
export const createI18nMiddleware = createI18nProxy;

/**
 * The former name of {@link I18nProxyOptions}.
 *
 * @deprecated Renamed alongside `createI18nMiddleware`.
 */
export type I18nMiddlewareOptions = I18nProxyOptions;

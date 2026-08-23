/**
 * `i18n-fs/proxy` — the locale-resolving proxy for Next.js 16 and later.
 *
 * The same module as `i18n-fs/middleware`, under the name Next.js now uses for
 * this file convention. Importing from the path that matches your filename
 * keeps the two from drifting in a codebase.
 */

export {
	createI18nProxy,
	createI18nMiddleware,
	LOCALE_HEADER,
	RECOMMENDED_MATCHER,
	RESOLVED_HEADER,
	type I18nProxyHandler,
	type I18nProxyOptions,
	type I18nMiddlewareOptions,
} from './middleware.js';

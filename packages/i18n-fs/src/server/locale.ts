/**
 * Resolving the active locale on the server.
 *
 * On a full page load the locale is derived from the request itself — the
 * header the middleware set, the cookie, or `Accept-Language` — never from
 * module state that could leak between requests.
 *
 * The pure part lives in `resolveLocaleFromRequest` so it can be tested without
 * a running Next.js, and so the ordering is written down in one place.
 */

import { cache } from 'react';
import type { ResolvedI18nFsConfig } from '../config.js';
import { loadCore } from '../core/index.js';
import { getI18nConfig } from './config.js';

/** Header the middleware uses to hand its decision to the server layer. */
export const LOCALE_HEADER = 'x-i18n-fs-locale';

/** Where the locale came from, for diagnostics. */
export type ServerLocaleSource = 'override' | 'header' | 'cookie' | 'accept-language' | 'default';

/** What the resolver needs to know about a request. */
export interface RequestSignals {
	/** Value of {@link LOCALE_HEADER}, if the middleware ran. */
	header?: string | null | undefined;
	/** Value of the locale cookie. */
	cookie?: string | null | undefined;
	/** Raw `Accept-Language` header. */
	acceptLanguage?: string | null | undefined;
	/** A locale the app pinned for this request, e.g. from a `[locale]` param. */
	override?: string | null | undefined;
}

/** The resolved locale and how it was chosen. */
export interface ResolvedLocale {
	locale: string;
	source: ServerLocaleSource;
}

/**
 * Pick the locale for a request.
 *
 * Order, most authoritative first:
 *
 * 1. an explicit override from the app — it knows its own route params;
 * 2. the middleware's header, which already applied the routing strategy;
 * 3. the cookie, which is the user's own stated choice;
 * 4. `Accept-Language`;
 * 5. the configured default.
 *
 * Unconfigured values are ignored rather than trusted: every one of these
 * arrives from the client and a locale flows straight into a file path.
 */
export function resolveLocaleFromRequest(
	config: ResolvedI18nFsConfig,
	signals: RequestSignals,
	negotiate: (acceptLanguage: string) => string,
): ResolvedLocale {
	const known = (value: string | null | undefined): string | undefined =>
		value ? config.locales.find((locale) => locale.toLowerCase() === value.toLowerCase()) : undefined;

	const ordered: [string | undefined, ServerLocaleSource][] = [
		[known(signals.override), 'override'],
		[known(signals.header), 'header'],
		[known(signals.cookie), 'cookie'],
	];

	for (const [locale, source] of ordered) {
		if (locale) return { locale, source };
	}

	if (signals.acceptLanguage) {
		const negotiated = known(negotiate(signals.acceptLanguage));
		// Negotiation returns the default when nothing matches, so only treat it
		// as a header match when it picked something else.
		if (negotiated && negotiated !== config.defaultLocale) {
			return { locale: negotiated, source: 'accept-language' };
		}
	}

	return { locale: config.defaultLocale, source: 'default' };
}

/**
 * A locale the app pins for the current request.
 *
 * Under the path strategy the `[locale]` route segment is authoritative, and a
 * Server Component cannot read the pathname. Pass the route param here, from a
 * layout, and everything below it resolves to that locale.
 *
 * `cache()` scopes this to one request. A module-level variable would leak the
 * last request's locale into the next one, which on a busy server means serving
 * somebody else's language.
 */
const requestOverride = cache((): { locale?: string } => ({}));

/** Pin the locale for this request. */
export function setRequestLocale(locale: string): void {
	requestOverride().locale = locale;
}

/** Read whatever {@link setRequestLocale} stored, if anything. */
export function getRequestLocale(): string | undefined {
	return requestOverride().locale;
}

/**
 * Read the request signals from Next.js.
 *
 * `next/headers` is imported lazily so this module can be loaded — and the pure
 * resolver tested — outside a Next.js request.
 */
async function readSignals(config: ResolvedI18nFsConfig): Promise<RequestSignals> {
	const { cookies, headers } = await import('next/headers');
	const [headerStore, cookieStore] = await Promise.all([headers(), cookies()]);

	return {
		override: getRequestLocale(),
		header: headerStore.get(LOCALE_HEADER),
		cookie: cookieStore.get(config.cookie.name)?.value,
		acceptLanguage: headerStore.get('accept-language'),
	};
}

/**
 * The active locale for this request.
 *
 * Memoised per request, so a layout and every component beneath it agree and
 * the headers are read once.
 */
export const getLocale = cache(async (): Promise<string> => {
	return (await getResolvedLocale()).locale;
});

/** The active locale together with how it was chosen. */
export const getResolvedLocale = cache(async (): Promise<ResolvedLocale> => {
	const config = await getI18nConfig();
	const core = await loadCore();

	return resolveLocaleFromRequest(config, await readSignals(config), (acceptLanguage) =>
		core.negotiateLocale(config, acceptLanguage),
	);
});

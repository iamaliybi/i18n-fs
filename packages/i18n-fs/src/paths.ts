/**
 * Building locale-prefixed paths, in TypeScript.
 *
 * The authoritative implementation is Rust: the middleware decides every
 * request through `decideRoute`, and the loop guarantee rests on that code
 * being idempotent ([ADR 0004]). This file is a deliberately smaller mirror,
 * and only of the two easy halves:
 *
 * - `addLocale`, because building a link means adding a prefix to a path that
 *   never had one — none of the stripping, normalising or fixed-point
 *   reasoning applies;
 * - `stripLocale`, because `usePathname` runs once on a URL the middleware has
 *   already canonicalised.
 *
 * It exists because `<Link>` cannot be asynchronous. Reading the WASM core
 * would make every link suspend on first paint, which is a bad trade for
 * roughly fifteen lines. `test/paths.test.ts` asserts this agrees with the Rust
 * implementation across generated inputs, so the two cannot drift.
 */

import type { PrefixMode, ResolvedI18nFsConfig } from './config.js';

/** Split a path into non-empty segments. */
function segments(path: string): string[] {
	return path.split('/').filter(Boolean);
}

function join(parts: string[]): string {
	return parts.length ? `/${parts.join('/')}` : '/';
}

function isLocale(config: ResolvedI18nFsConfig, segment: string): string | undefined {
	return config.locales.find((locale) => locale.toLowerCase() === segment.toLowerCase());
}

/**
 * The locale that goes unprefixed under `as-needed`.
 *
 * Under the domain strategy that is the locale the host itself serves, not the
 * global default — the same rule the core applies, and the one whose absence
 * caused a redirect loop before [ADR 0004].
 */
export function baseLocale(config: ResolvedI18nFsConfig, host?: string | null): string {
	if (config.strategy === 'domain' && host) {
		const hostname = host.split(':')[0]!.toLowerCase();
		const rule = config.domains.find((entry) => entry.domain.toLowerCase() === hostname);
		if (rule) return rule.locale;
	}

	return config.defaultLocale;
}

/** Whether a locale is visible in the URL under this configuration. */
export function needsPrefix(prefix: PrefixMode, locale: string, base: string): boolean {
	switch (prefix) {
		case 'always':
			return true;
		case 'as-needed':
			return locale.toLowerCase() !== base.toLowerCase();
		case 'never':
			return false;
	}
}

/** Remove every leading locale segment. */
export function stripLocale(config: ResolvedI18nFsConfig, pathname: string): string {
	const parts = segments(pathname);
	while (parts.length && isLocale(config, parts[0]!)) parts.shift();
	return join(parts);
}

/** Add the locale prefix to a locale-free path, honouring the prefix mode. */
export function addLocale(
	config: ResolvedI18nFsConfig,
	path: string,
	locale: string,
	base: string,
): string {
	if (!needsPrefix(config.prefix, locale, base)) return join(segments(path));
	return join([locale, ...segments(path)]);
}

/**
 * The public path for `href` under `locale`.
 *
 * `href` may already carry a locale — a hand-written `/en/about`, say — so it is
 * stripped first and the active locale applied. That makes the function
 * idempotent for the same reason the core's version is.
 */
export function localePath(
	config: ResolvedI18nFsConfig,
	href: string,
	locale: string,
	host?: string | null,
): string {
	// Anything that is not a path of ours — an absolute URL, a fragment, a
	// mailto: — is left exactly as written.
	if (!href.startsWith('/')) return href;

	const [pathAndQuery = '', hash] = splitOnce(href, '#');
	const [path = '', query] = splitOnce(pathAndQuery, '?');

	const prefixed = addLocale(config, stripLocale(config, path), locale, baseLocale(config, host));

	return prefixed + (query ? `?${query}` : '') + (hash ? `#${hash}` : '');
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
	const index = value.indexOf(separator);
	if (index === -1) return [value, undefined];
	return [value.slice(0, index), value.slice(index + 1)];
}

/**
 * The public URL of a namespace, with the content hash for cache-busting.
 *
 * Lives here rather than beside the client fetch because the server needs it
 * too, to emit preload links — and a function exported from a `'use client'`
 * module is a client reference, not something a Server Component can call.
 */
export function namespaceUrl(
	config: ResolvedI18nFsConfig,
	locale: string,
	namespace: string,
	hash?: string,
): string {
	const path = `/${config.messagesDir}/${locale}/${namespace}.json`;

	// Files under `public/` are served verbatim and are not fingerprinted, so
	// the hash is what lets the response be cached immutably and still change
	// when the content does.
	return hash ? `${path}?v=${hash}` : path;
}

/**
 * The `i18n-fs.config.ts` contract.
 *
 * This file is the single place an application declares its locales, default
 * locale and routing strategy. The CLI compiles it once into a plain snapshot
 * (see {@link I18nFsConfig}) because the Edge runtime has no TypeScript loader
 * and WebAssembly has no module system — neither can import this file directly.
 */

/** How the active locale is carried between requests. */
export type RoutingStrategy =
	/** The locale lives in the first path segment (`/fa/about`). */
	| 'path'
	/** The locale is bound to the hostname (`example.ir` -> `fa`). */
	| 'domain'
	/** The locale lives only in a cookie; the URL never shows it. */
	| 'cookie';

/** Whether the locale is visible in the public URL. */
export type PrefixMode =
	/** Every locale is prefixed, including the default one. */
	| 'always'
	/** Every locale except the unprefixed base locale. */
	| 'as-needed'
	/** No locale is ever prefixed; the URL hides the locale entirely. */
	| 'never';

/** One hostname bound to a locale, for the `domain` strategy. */
export interface DomainRule {
	/** Hostname without scheme or port, e.g. `example.ir`. */
	domain: string;
	/** Locale served by that hostname. */
	locale: string;
	/**
	 * Extra locales this domain may serve through a path prefix. Empty means the
	 * domain is single-locale and a stray prefix is normalised away.
	 */
	locales?: string[];
}

/** Cookie used to persist an explicit locale choice. */
export interface CookieConfig {
	name?: string;
	/** Seconds. Defaults to one year. */
	maxAge?: number;
	sameSite?: 'lax' | 'strict' | 'none';
	path?: string;
	secure?: boolean;
}

/** The configuration an application writes. */
export interface I18nFsConfig {
	/** Every locale the application ships, as BCP-47 tags. */
	locales: string[];
	/**
	 * Locale used when nothing else resolves.
	 *
	 * This is a *routing* fallback only. A missing message never falls back to
	 * another locale's content — it falls back to the developer-supplied string,
	 * or to the key.
	 */
	defaultLocale: string;
	/** How the locale travels with the request. Defaults to `path`. */
	strategy?: RoutingStrategy;
	/** Whether the locale is visible in the URL. Defaults to `as-needed`. */
	prefix?: PrefixMode;
	/** Hostname bindings. Required for the `domain` strategy. */
	domains?: DomainRule[];
	cookie?: CookieConfig;
	/**
	 * Directory under `public/` holding the message tree, as
	 * `public/<messagesDir>/<locale>/<namespace>.json`.
	 *
	 * Defaults to `locales`. The folder layout beneath it is entirely yours;
	 * `i18n-fs` imposes no structure and no shared-key convention.
	 */
	messagesDir?: string;
	/**
	 * Whether every locale must define the same keys as the default one.
	 * Defaults to `true`.
	 *
	 * With it on, `i18n-fs check` reports a key present in the default locale
	 * and absent elsewhere as an error, and `build` refuses to write. That is
	 * the right default: this package never falls back to another locale's
	 * content, so a key missing from one language is invisible until somebody
	 * reading that language hits the page.
	 *
	 * Turn it off when the locales are not translations of one another. A site
	 * whose German pages are written for a German audience rather than
	 * translated from the English ones has different keys by design, and there
	 * is nothing to report.
	 *
	 * ```ts
	 * export default defineConfig({
	 *   locales: ['en', 'de'],
	 *   defaultLocale: 'en',
	 *   compareLocales: false,
	 * });
	 * ```
	 *
	 * It also changes what `build` generates. With comparison on, the typed key
	 * registry comes from the default locale, because `check` guarantees the
	 * others match it. With comparison off there is no such guarantee, so the
	 * registry is the union of every locale — otherwise a key that exists only
	 * in German would not compile.
	 *
	 * Everything that is not a comparison between locales still runs: malformed
	 * JSON, an empty namespace, a directory for a locale that is not configured.
	 *
	 * `i18n-fs check --compare-locales` runs the comparison anyway, without
	 * changing the file, for when you want to see the differences once.
	 */
	compareLocales?: boolean;
	/** Emit developer diagnostics. Defaults to `process.env.NODE_ENV !== 'production'`. */
	debug?: boolean;
}

/**
 * The snapshot the core receives: every optional field resolved.
 *
 * Produced by the CLI from an {@link I18nFsConfig}; not written by hand.
 */
export interface ResolvedI18nFsConfig {
	locales: string[];
	defaultLocale: string;
	strategy: RoutingStrategy;
	prefix: PrefixMode;
	domains: Required<DomainRule>[];
	cookie: Required<CookieConfig>;
	messagesDir: string;
	compareLocales: boolean;
	debug: boolean;
}

/**
 * Identity function that types an `i18n-fs.config.ts` export.
 *
 * ```ts
 * import { defineConfig } from 'i18n-fs/config';
 *
 * export default defineConfig({
 *   locales: ['fa', 'en'],
 *   defaultLocale: 'fa',
 *   strategy: 'path',
 *   prefix: 'as-needed',
 * });
 * ```
 *
 * It deliberately does not validate. Validation happens in the CLI, where every
 * problem can be reported at once against the real file — see
 * `i18n_fs_core::I18nConfig::validate`.
 */
export function defineConfig(config: I18nFsConfig): I18nFsConfig {
	return config;
}

/** Defaults applied when the CLI compiles a config into a snapshot. */
export const CONFIG_DEFAULTS = {
	strategy: 'path',
	prefix: 'as-needed',
	messagesDir: 'locales',
	compareLocales: true,
	cookie: {
		name: 'I18N_FS_LOCALE',
		maxAge: 60 * 60 * 24 * 365,
		sameSite: 'lax',
		path: '/',
		secure: true,
	},
} as const satisfies Partial<ResolvedI18nFsConfig>;

/**
 * The shape `withI18nFs` accepts.
 *
 * Typed structurally rather than against `NextConfig` so this entry point does
 * not need Next.js installed to type-check.
 */
export interface MinimalNextConfig {
	[key: string]: unknown;
}

/**
 * Formerly wrapped `next.config` so the WebAssembly core could load.
 *
 * @deprecated No longer necessary, and harmful on Next.js 16. It now returns
 * the configuration unchanged.
 *
 * It used to enable webpack's `asyncWebAssembly` experiment, because the Edge
 * and Node binaries were imported as WebAssembly modules. Both are embedded as
 * bytes now, so nothing imports a `.wasm` module except the browser build —
 * which reaches it through `new URL(..., import.meta.url)`, an ordinary asset
 * reference every bundler already understands.
 *
 * Worse than unnecessary: Next.js 16 defaults to Turbopack and rejects a
 * project that has a `webpack` config and no `turbopack` config. Adding one was
 * enough to fail the build outright. Returning the configuration untouched
 * fixes that for anyone who already calls this.
 *
 * Verified with no wrapper at all on Next.js 15 with `middleware.ts` and
 * Next.js 16 with `proxy.ts`.
 */
export function withI18nFs<T extends MinimalNextConfig>(nextConfig: T): T {
	return nextConfig;
}

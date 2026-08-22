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
	cookie: {
		name: 'I18N_FS_LOCALE',
		maxAge: 60 * 60 * 24 * 365,
		sameSite: 'lax',
		path: '/',
		secure: true,
	},
} as const satisfies Partial<ResolvedI18nFsConfig>;

/**
 * The shape of the bits of `next.config` that {@link withI18nFs} touches.
 *
 * Typed structurally rather than against `NextConfig` so this entry point does
 * not need Next.js installed to type-check.
 */
export interface MinimalNextConfig {
	webpack?: ((config: WebpackConfig, context: unknown) => WebpackConfig) | undefined;
	[key: string]: unknown;
}

interface WebpackConfig {
	experiments?: Record<string, unknown> | undefined;
	[key: string]: unknown;
}

/**
 * Wrap `next.config` so the WebAssembly core can load in middleware.
 *
 * The Edge middleware imports a `.wasm` file, and webpack has kept WebAssembly
 * behind an experiment flag since v5. Without this the build fails with
 * "module is not flagged as WebAssembly module", which is a genuinely
 * unhelpful place for someone to start debugging.
 *
 * ```js
 * // next.config.mjs
 * import { withI18nFs } from 'i18n-fs/config';
 *
 * export default withI18nFs({});
 * ```
 *
 * Only the Edge build needs this. The Node build embeds its binary rather than
 * loading it from disk, precisely so that no bundler configuration stands
 * between an application and a working server.
 *
 * Turbopack handles WebAssembly natively, so this is inert there.
 */
export function withI18nFs<T extends MinimalNextConfig>(nextConfig: T): T {
	return {
		...nextConfig,
		webpack(config: WebpackConfig, context: unknown) {
			// The Edge middleware imports a `.wasm` module, and webpack has kept
			// WebAssembly behind an experiment flag since v5.
			config.experiments = { ...config.experiments, asyncWebAssembly: true };
			return nextConfig.webpack ? nextConfig.webpack(config, context) : config;
		},
	};
}


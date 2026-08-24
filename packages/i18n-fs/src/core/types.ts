/**
 * The typed surface of the WebAssembly core.
 *
 * These types mirror the `serde` representations in `crates/i18n-fs-core`. They
 * are hand-written rather than generated because wasm-bindgen's `.d.ts` output
 * types every structured value as `any`, which would erase the contract at
 * exactly the boundary where it matters most.
 */

import type { ErrorCode } from '../errors.js';

export type { ErrorCode };

/** A failed lookup, with enough context to find the offending file and key. */
export interface I18nErrorPayload {
	code: ErrorCode;
	locale: string;
	namespace: string;
	scope: string | null;
	key: string | null;
	detail: string | null;
}

/** One problem found in a configuration snapshot. */
export interface ConfigIssue {
	/** Always {@link ErrorCode.InvalidConfig}. */
	code: ErrorCode;
	field: string;
	message: string;
}

/** Everything the core needs to know about an incoming request. */
export interface RequestInfo {
	pathname: string;
	host?: string | null;
	cookieLocale?: string | null;
	acceptLanguage?: string | null;
	/** Set when a previous middleware pass already resolved this request. */
	alreadyResolved?: boolean;
}

/** What the middleware should do with a request. */
export type Action =
	| { type: 'next' }
	| { type: 'rewrite'; path: string }
	| { type: 'redirect'; path: string; permanent: boolean };

/** Where the active locale came from. */
export type LocaleSource = 'path' | 'domain' | 'cookie' | 'header' | 'default';

/** The middleware decision. */
/**
 * What the proxy should do with one request.
 *
 * Flat rather than a tagged union: a union would have to cross the boundary as
 * a serialised object, which is what this whole shape exists to avoid. `path`
 * is empty when the action is `next`.
 */
export interface Decision {
	/** The locale active for this request. */
	readonly locale: string;
	/** `'next'`, `'rewrite'` or `'redirect'`. */
	readonly action: 'next' | 'rewrite' | 'redirect';
	/** Where to rewrite or redirect to; empty string when the action is `next`. */
	readonly path: string;
	/** `true` for a 308, `false` for a 307. Only meaningful for a redirect. */
	readonly permanent: boolean;
	/** Whether the locale cookie should be written on the response. */
	readonly setCookie: boolean;
	/** How the locale was determined, for debugging. */
	readonly source: LocaleSource;
	/** Release the WebAssembly handle. */
	free(): void;
}

/** A node of a parsed rich message. */
export type MessageNode =
	| { type: 'text'; value: string }
	| { type: 'param'; name: string }
	| { type: 'tag'; name: string; children: MessageNode[] };

/** Result of substituting placeholders in a plain message. */
export interface Interpolation {
	value: string;
	/** Placeholders with no matching parameter. Their markers stay in `value`. */
	missing: string[];
}

/** One parsed namespace file. */
export interface Store {
	readonly size: number;
	keys(): string[];
	has(scope: string | undefined, key: string): boolean;
	resolveText(scope: string | undefined, key: string): string;
	resolveList(scope: string | undefined, key: string): string[];
	resolveAny(scope: string | undefined, key: string): string | string[];
	free(): void;
}

/**
 * The subset of the core present in every build, including the Edge one.
 *
 * Anything outside this interface exists only where the corresponding cargo
 * feature was compiled in, which is why they are separated at the type level:
 * reaching for `interpolate` in middleware should be a type error, not a
 * runtime `undefined`.
 */
/**
 * A compiled configuration, ready to answer routing questions.
 *
 * Built once from primitives rather than handed a serialised config on every
 * call. The config never changes while the process lives, and serialising it
 * per request meant `serde-wasm-bindgen` in the Edge binary — about a third of
 * it, for the one binary that runs on every request.
 */
export interface Router {
	/** Bind a hostname to a locale, with optional extra prefixed locales. */
	addDomain(domain: string, locale: string, locales: string[]): void;
	/** The best supported locale for an `Accept-Language` header. */
	negotiateLocale(acceptLanguage?: string): string;
	/** What the proxy should do with one request. */
	decideRoute(
		pathname: string,
		host?: string,
		cookieLocale?: string,
		acceptLanguage?: string,
		alreadyResolved?: boolean,
	): Decision;
	/** The canonical public path for a pathname under a locale. */
	canonicalPath(pathname: string, locale: string, host?: string): string;
	/** The internal, always locale-prefixed path Next.js routes to. */
	internalPath(pathname: string, locale: string): string;
	/** The hostname serving a locale, under the domain strategy. */
	domainForLocale(locale: string): string | undefined;
	/** Release the WebAssembly handle. */
	free(): void;
}

export interface EdgeCore {
	coreVersion(): string;
	Router: new (
		locales: string[],
		defaultLocale: string,
		strategy: string,
		prefix: string,
		messagesDir: string,
		cookieName: string,
		cookieMaxAge: number,
		cookieSameSite: string,
		cookiePath: string,
		cookieSecure: boolean,
		debug: boolean,
	) => Router;
}

/**
 * Message storage and formatting, with no routing.
 *
 * This is what the browser binary carries. A visitor downloads it, and nothing
 * in the browser routes — `<Link>` and `usePathname` are answered by a
 * TypeScript mirror of the same rules so they stay synchronous, and every
 * redirect decision is made by the proxy before the page is served. Compiling
 * routing in anyway cost 34 KB gzip that no browser executed.
 */
export interface MessageCore {
	coreVersion(): string;
	Store: new (locale: string, namespace: string, raw: string) => Store;
	interpolate(template: string, params?: Record<string, string>): Interpolation;
	tokenize(template: string): MessageNode[];
}

/**
 * Both halves. Only the Node binary carries them, because only the server needs
 * to route *and* resolve messages in the same process.
 */
export interface FullCore extends EdgeCore, MessageCore {
	validateConfig(config: unknown): ConfigIssue[];
}

/** What shape a key holds. */
export type LeafKind = 'text' | 'list';

/** One key of a namespace and the shape it holds. */
export interface NamespaceEntry {
	key: string;
	kind: LeafKind;
}

/**
 * A store from the Node build, which additionally knows how to enumerate a
 * namespace.
 *
 * Enumeration is a build-time concern, so it is compiled into the Node binary
 * only — the browser resolves messages, it never lists them.
 */
export interface CliStore extends Store {
	/** Every key with its shape, sorted, so generated files do not churn. */
	entries(): NamespaceEntry[];
	/** Every scope, sorted, with the root as an empty string. */
	scopes(): string[];
}

/** The Node build of the core, as used by the CLI. */
export interface CliCore extends Omit<FullCore, 'Store'> {
	Store: new (locale: string, namespace: string, raw: string) => CliStore;
}

/**
 * Which core build this runtime loaded.
 *
 * Deliberately typed as the union rather than a literal in each binding file:
 * TypeScript resolves only one variant when type-checking, and a literal type
 * would make the capability check look like dead code.
 */
export type Capability = 'edge' | 'messages' | 'full';

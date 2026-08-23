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
export interface Decision {
	locale: string;
	action: Action;
	setCookie: boolean;
	source: LocaleSource;
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
export interface EdgeCore {
	coreVersion(): string;
	negotiateLocale(config: unknown, acceptLanguage?: string): string;
	decideRoute(config: unknown, request: RequestInfo): Decision;
	canonicalPath(config: unknown, pathname: string, locale: string, host?: string): string;
	internalPath(config: unknown, pathname: string, locale: string): string;
	domainForLocale(config: unknown, locale: string): string | undefined;
}

/** The full core: everything in {@link EdgeCore} plus messages and formatting. */
export interface FullCore extends EdgeCore {
	validateConfig(config: unknown): ConfigIssue[];
	Store: new (locale: string, namespace: string, raw: string) => Store;
	interpolate(template: string, params?: Record<string, string>): Interpolation;
	tokenize(template: string): MessageNode[];
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
export type Capability = 'edge' | 'full';

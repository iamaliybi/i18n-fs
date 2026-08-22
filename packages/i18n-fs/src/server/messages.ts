/**
 * Loading namespaces on the server.
 *
 * Files live under `public/` ([ADR 0002]) and the server reads them with `fs`.
 * Fetching its own origin over HTTP to read a local file would be a wasted
 * round trip on every render.
 *
 * A namespace that cannot be read is *not* an exception. Loading is best-effort
 * by design: one missing file must not blank a page, so the failure is captured
 * and surfaced later, per key, through the normal fallback path.
 */

import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import type { ResolvedI18nFsConfig } from '../config.js';
import { loadFullCore } from '../core/index.js';
import type { I18nErrorPayload } from '../core/types.js';
import type { NamespaceState } from '../translator.js';

/** Namespaces loaded for one locale, keyed by namespace. */
export type MessageBundle = Map<string, NamespaceState>;

/** The raw JSON of each namespace, for handing to the client. */
export type SerialisableBundle = Record<string, unknown>;

const caches = new Map<string, Map<string, NamespaceState>>();

/** Absolute path of a namespace file. */
export function namespacePath(
	cwd: string,
	config: ResolvedI18nFsConfig,
	locale: string,
	namespace: string,
): string {
	return join(cwd, 'public', config.messagesDir, locale, `${namespace}.json`);
}

/**
 * Whether a namespace is a plain relative path inside the messages directory.
 *
 * A namespace reaches this function from application code, but application code
 * is not always the one choosing it — a route segment or a CMS value can end up
 * here. `..` in a namespace would read arbitrary files off the disk and hand
 * them to the browser through the provider, so it is rejected outright.
 */
export function isSafeNamespace(namespace: string): boolean {
	if (!namespace || namespace.startsWith('/') || namespace.startsWith('\\')) return false;
	if (/^[a-zA-Z]:/.test(namespace)) return false;

	const normalised = normalize(namespace);
	return !normalised.startsWith('..') && !normalised.split(/[\\/]/).includes('..');
}

function error(
	code: I18nErrorPayload['code'],
	locale: string,
	namespace: string,
	detail?: string,
): I18nErrorPayload {
	return { code, locale, namespace, scope: null, key: null, detail: detail ?? null };
}

/**
 * Load one namespace.
 *
 * Results are cached per locale for the lifetime of the process. Message files
 * are build-time assets: re-reading and re-parsing them on every render would
 * be pure waste, and the cache is bounded by the number of files on disk rather
 * than by traffic.
 */
export async function loadNamespace(
	config: ResolvedI18nFsConfig,
	locale: string,
	namespace: string,
	cwd: string = process.cwd(),
): Promise<NamespaceState> {
	let cache = caches.get(locale);
	if (!cache) {
		cache = new Map();
		caches.set(locale, cache);
	}

	const cached = cache.get(namespace);
	if (cached) return cached;

	const state = await readNamespace(config, locale, namespace, cwd);

	// In development the file may be fixed and the page reloaded, so a failure
	// is not cached — otherwise the developer would have to restart the server
	// to see their own correction.
	if (state.status === 'ready' || !config.debug) {
		cache.set(namespace, state);
	}

	return state;
}

async function readNamespace(
	config: ResolvedI18nFsConfig,
	locale: string,
	namespace: string,
	cwd: string,
): Promise<NamespaceState> {
	if (!isSafeNamespace(namespace)) {
		return {
			status: 'failed',
			error: error(
				'NAMESPACE_NOT_FOUND',
				locale,
				namespace,
				'a namespace must be a relative path inside the messages directory',
			),
		};
	}

	const path = namespacePath(cwd, config, locale, namespace.split('/').join(sep));

	let raw: string;
	try {
		raw = await readFile(path, 'utf8');
	} catch (cause) {
		return {
			status: 'failed',
			error: error(
				'NAMESPACE_NOT_FOUND',
				locale,
				namespace,
				cause instanceof Error ? cause.message : String(cause),
			),
		};
	}

	const core = await loadFullCore();

	try {
		return { status: 'ready', store: new core.Store(locale, namespace, raw) };
	} catch (cause) {
		// The core already distinguishes INVALID_JSON and carries the parser's
		// line and column; pass it through rather than flattening it.
		if (typeof cause === 'object' && cause !== null && 'code' in cause) {
			return { status: 'failed', error: cause as I18nErrorPayload };
		}

		return {
			status: 'failed',
			error: error('INVALID_JSON', locale, namespace, String(cause)),
		};
	}
}

/** Load several namespaces at once. */
export async function loadNamespaces(
	config: ResolvedI18nFsConfig,
	locale: string,
	namespaces: readonly string[],
	cwd: string = process.cwd(),
): Promise<MessageBundle> {
	const unique = [...new Set(namespaces)];
	const states = await Promise.all(
		unique.map((namespace) => loadNamespace(config, locale, namespace, cwd)),
	);

	return new Map(unique.map((namespace, index) => [namespace, states[index]!]));
}

/**
 * The raw JSON of each namespace, for serialising into the client payload.
 *
 * Namespaces that failed to load are omitted rather than sent as an error: the
 * client reports its own `NAMESPACE_NOT_FOUND` for anything absent, which is
 * the same diagnosis by the same path.
 */
export async function readRawNamespaces(
	config: ResolvedI18nFsConfig,
	locale: string,
	namespaces: readonly string[],
	cwd: string = process.cwd(),
): Promise<SerialisableBundle> {
	const bundle: SerialisableBundle = {};

	await Promise.all(
		[...new Set(namespaces)].map(async (namespace) => {
			if (!isSafeNamespace(namespace)) return;

			try {
				const path = namespacePath(cwd, config, locale, namespace.split('/').join(sep));
				bundle[namespace] = JSON.parse(await readFile(path, 'utf8')) as unknown;
			} catch {
				// Reported on the client, where the component that needs it lives.
			}
		}),
	);

	return bundle;
}

/** Content hash per namespace, for one locale. */
export type LocaleManifest = Record<string, string>;

let manifestCache: Promise<Record<string, LocaleManifest>> | undefined;

/**
 * The manifest the CLI generated.
 *
 * Absent when `i18n-fs build` has not run. That is not fatal: without hashes
 * the client fetches unversioned URLs, which still work — they just cannot be
 * cached immutably. Failing the render over a caching optimisation would be
 * the wrong trade.
 */
export async function readManifest(
	cwd: string = process.cwd(),
): Promise<Record<string, LocaleManifest>> {
	manifestCache ??= readFile(join(cwd, '.i18n-fs', 'manifest.json'), 'utf8')
		.then((raw) => JSON.parse(raw) as Record<string, LocaleManifest>)
		.catch(() => ({}));

	return manifestCache;
}

/** The hashes for one locale. */
export async function readLocaleManifest(
	locale: string,
	cwd: string = process.cwd(),
): Promise<LocaleManifest> {
	return (await readManifest(cwd))[locale] ?? {};
}

/** Drop every cached namespace. Exposed for tests. */
export function clearMessageCache(): void {
	caches.clear();
	manifestCache = undefined;
}

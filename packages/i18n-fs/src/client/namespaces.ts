/**
 * Client-side namespace loading.
 *
 * `use()` identifies a suspended read by promise identity, so every read of the
 * same namespace has to get *the same promise object* — not merely an
 * equivalent one. That is the whole reason this cache exists at module scope
 * rather than in a ref or a state hook: a promise created during render would
 * be a new one on every attempt, and the component would suspend forever.
 *
 * The prototype this replaces threw a promise from inside the hook and tracked
 * its progress in a local variable, which was reset by the very re-render the
 * promise triggered.
 */

import type { ResolvedI18nFsConfig } from '../config.js';
import { namespaceUrl } from '../paths.js';
import { loadMessageCore } from '../core/index.js';
import { ErrorCode } from '../errors.js';
import type { I18nErrorPayload, MessageCore } from '../core/types.js';
import type { NamespaceState } from '../translator.js';

export { namespaceUrl };

const cache = new Map<string, Promise<NamespaceState>>();

/**
 * Cache key. Locale is part of it because the same namespace differs per locale.
 *
 * The separator is escaped rather than written as a literal byte: a raw control
 * character in the source makes grep and ripgrep classify the file as binary and
 * skip it entirely, so searches quietly miss every line in it.
 */
function keyOf(locale: string, namespace: string): string {
	return `${locale}
${namespace}`;
}

/**
 * What to do about a client-side failure.
 *
 * The result is cached, so nothing retries by itself: without this the reader
 * would see a fallback and the developer would have no idea the page was
 * holding a stale answer.
 */
const RELOAD_HINT =
	'this result is kept until the page is reloaded, so reload once it is fixed; ' +
	'if a reload still shows it, restart the dev server';

function failure(
	code: I18nErrorPayload['code'],
	locale: string,
	namespace: string,
	detail: string,
): NamespaceState {
	return {
		status: 'failed',
		error: { code, locale, namespace, scope: null, key: null, detail },
	};
}

/** Build a store from content the server already sent, or record why not. */
export function stateFromPayload(
	core: MessageCore,
	locale: string,
	namespace: string,
	payload: unknown,
): NamespaceState {
	try {
		// Re-serialising costs one native `JSON.stringify`. Handing the object
		// across the WASM boundary property by property would need a binding that
		// costs every page 1.6 KB of binary, and walking the graph that way is not
		// obviously faster than parsing a string once.
		return { status: 'ready', store: new core.Store(locale, namespace, JSON.stringify(payload)) };
	} catch (cause) {
		if (typeof cause === 'object' && cause !== null && 'code' in cause) {
			return { status: 'failed', error: cause as I18nErrorPayload };
		}
		return failure(ErrorCode.InvalidJson, locale, namespace, String(cause));
	}
}

async function fetchNamespace(
	config: ResolvedI18nFsConfig,
	locale: string,
	namespace: string,
	hash?: string,
): Promise<NamespaceState> {
	// A relative URL has no origin to resolve against while a Client Component
	// is being server-rendered, so the fetch would fail with an unhelpful
	// "Failed to parse URL". Say what to do about it instead.
	if (typeof window === 'undefined') {
		return failure(
			ErrorCode.NamespaceNotFound,
			locale,
			namespace,
			`a Client Component asked for "${namespace}" during server rendering. ` +
				'Add it to the namespaces prop of <I18nProvider> so the server sends it.',
		);
	}

	const core = await loadMessageCore();
	const url = namespaceUrl(config, locale, namespace, hash);

	let response: Response;
	try {
		// Development bypasses the browser cache. The URL carries a content hash
		// from the build manifest, which is generated before `next dev` starts
		// and therefore does not move while a developer edits messages — so
		// without this a reload would be served the old file by the browser and
		// the edit would appear to have done nothing.
		response = config.debug ? await fetch(url, { cache: 'no-store' }) : await fetch(url);
	} catch (cause) {
		return failure(
			ErrorCode.NamespaceNotFound,
			locale,
			namespace,
			`${cause instanceof Error ? cause.message : String(cause)}; ${RELOAD_HINT}`,
		);
	}

	if (!response.ok) {
		return failure(
			ErrorCode.NamespaceNotFound,
			locale,
			namespace,
			`${url} responded ${response.status}; ${RELOAD_HINT}`,
		);
	}

	const raw = await response.text();

	try {
		return { status: 'ready', store: new core.Store(locale, namespace, raw) };
	} catch (cause) {
		if (typeof cause === 'object' && cause !== null && 'code' in cause) {
			return { status: 'failed', error: cause as I18nErrorPayload };
		}
		return failure(ErrorCode.InvalidJson, locale, namespace, String(cause));
	}
}

/**
 * The namespace, as a promise stable across renders.
 *
 * Never rejects: a failed load resolves to a `failed` state so the component
 * renders with fallbacks instead of hitting an error boundary. One missing
 * translation file must not take a page down.
 */
export function loadClientNamespace(
	config: ResolvedI18nFsConfig,
	locale: string,
	namespace: string,
	hash?: string,
): Promise<NamespaceState> {
	const key = keyOf(locale, namespace);

	let pending = cache.get(key);
	if (!pending) {
		pending = fetchNamespace(config, locale, namespace, hash);
		cache.set(key, pending);
	}

	return pending;
}

/**
 * Start loading a namespace without waiting for it.
 *
 * The point is that nobody suspends: this is called from an event handler or a
 * layout effect, the request goes out early, and by the time a component reads
 * the namespace the answer is already there.
 *
 * A prefetch that fails is **not** remembered. A read that fails is cached, so
 * that one 404 does not become a request per render — but a prefetch is
 * speculative, and letting a transient blip poison the read that actually needs
 * the namespace would turn a guess into a permanent fallback. Failing quietly
 * and leaving the cache empty means the real read starts clean.
 */
export function prefetchNamespace(
	config: ResolvedI18nFsConfig,
	locale: string,
	namespace: string,
	hash?: string,
): void {
	const key = keyOf(locale, namespace);

	// Already loaded, already in flight, or already sent by the server.
	if (cache.has(key)) return;

	const pending = fetchNamespace(config, locale, namespace, hash).then((state) => {
		if (state.status === 'failed' && cache.get(key) === pending) cache.delete(key);
		return state;
	});

	cache.set(key, pending);
}

/** Seed the cache with something the server already sent. */
export function seedNamespace(locale: string, namespace: string, state: NamespaceState): void {
	cache.set(keyOf(locale, namespace), Promise.resolve(state));
}

/** Whether a namespace has already been read or seeded. */
export function hasNamespace(locale: string, namespace: string): boolean {
	return cache.has(keyOf(locale, namespace));
}

/** Drop every cached namespace. Exposed for tests. */
export function clearNamespaceCache(): void {
	cache.clear();
}

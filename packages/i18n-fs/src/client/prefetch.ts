'use client';

/**
 * `usePrefetch` — warm a namespace before something needs it.
 *
 * A Client Component that reads a namespace the server did not send suspends
 * while it fetches, and the nearest `<Suspense>` boundary shows its fallback.
 * That is correct, and for a panel behind a button it is still a visible pause
 * at exactly the moment the visitor asked for something.
 *
 * Prefetching moves the request earlier — to the hover, the focus, the moment
 * the menu opens — so the namespace has usually arrived by the time it is read
 * and nothing suspends at all.
 *
 * ```tsx
 * const prefetch = usePrefetch();
 *
 * <button
 *   onPointerEnter={() => prefetch('settings/panel')}
 *   onFocus={() => prefetch('settings/panel')}
 *   onClick={() => setOpen(true)}
 * >
 * ```
 *
 * `onFocus` as well as `onPointerEnter`, because a keyboard user never hovers
 * and a touch user has no hover at all — prefetching only on hover quietly
 * gives the fastest experience to the people who need it least.
 *
 * Calling it for something already loaded, already in flight, or already sent
 * by the server does nothing. Calling it for something that never gets read
 * costs one request, which is why it belongs on an intent signal rather than on
 * mount: at that point `<I18nProvider namespaces>` sends the content with the
 * page and there is nothing left to wait for.
 */

import { useCallback } from 'react';
import { useI18nContext } from './context.js';
import { prefetchNamespace } from './namespaces.js';

/**
 * Returns a function that starts loading namespaces in the background.
 *
 * Never throws, never suspends, and returns nothing to await — a prefetch that
 * fails leaves no trace, so the read that follows behaves exactly as it would
 * have without it.
 */
export function usePrefetch(): (...namespaces: string[]) => void {
	const { config, locale, manifest, messages } = useI18nContext();

	return useCallback(
		(...namespaces: string[]) => {
			for (const namespace of namespaces) {
				// Already in the page payload: there is nothing to fetch.
				if (messages[namespace] !== undefined) continue;

				prefetchNamespace(config, locale, namespace, manifest[namespace]);
			}
		},
		[config, locale, manifest, messages],
	);
}

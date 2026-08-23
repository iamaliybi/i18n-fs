/**
 * `I18nProvider` — the boundary between the server and the client.
 *
 * A Server Component that resolves the locale from the request and renders the
 * client provider with it. Place it in the root layout, above anything that
 * reads a translation.
 *
 * Only the namespaces named in `namespaces` are sent to the browser. Shipping
 * the whole message tree would be simpler and would also put every string of
 * every page into the payload of each one.
 */

import type { ReactNode } from 'react';
// Imported by package path, not relative: that is what keeps the 'use client'
// boundary a real module rather than something the bundler inlines here.
import { I18nClientProvider } from 'i18n-fs/client';
import { namespaceUrl } from '../paths.js';
import { getI18nConfig } from './config.js';
import { getLocale } from './locale.js';
import { readLocaleManifest, readRawNamespaces, type SerialisableBundle } from './messages.js';

/** Props of {@link I18nProvider}. */
export interface I18nProviderProps {
	/**
	 * Namespaces to send to the client.
	 *
	 * Server Components load what they need themselves through
	 * `getTranslation`; this is only for Client Components, which cannot read
	 * the filesystem. Anything omitted is fetched by the browser on demand.
	 */
	namespaces?: readonly string[];
	/**
	 * Namespaces to start downloading, without putting them in the payload.
	 *
	 * The middle setting between `namespaces` and neither. `namespaces` inlines
	 * the JSON into the HTML: nothing to wait for, but every visitor carries it
	 * whether or not the component that reads it ever renders. Omitting it
	 * entirely means a request that begins only after hydration.
	 *
	 * This emits a `<link rel="preload">` instead, so the browser fetches in
	 * parallel with the JavaScript and the response is in its cache before the
	 * component asks. The HTML does not grow.
	 *
	 * Use it for what a Client Component reads a moment after the page settles.
	 * For anything read on first paint, `namespaces` is still right — a preload
	 * that lands late is a suspended component, and one that never gets read is
	 * a wasted request.
	 */
	prefetch?: readonly string[];
	/**
	 * Override the resolved locale.
	 *
	 * Useful under the path strategy, where the `[locale]` route segment is
	 * authoritative and a Server Component cannot read the pathname. Prefer
	 * `setRequestLocale`, which also applies to `getTranslation` calls above
	 * this provider.
	 */
	locale?: string;
	children: ReactNode;
}

/** Provides the active locale and pre-loaded messages to the client tree. */
export async function I18nProvider({
	namespaces = [],
	prefetch = [],
	locale: explicitLocale,
	children,
}: I18nProviderProps) {
	const config = await getI18nConfig();
	const locale = explicitLocale ?? (await getLocale());

	const [messages, manifest] = await Promise.all([
		namespaces.length
			? readRawNamespaces(config, locale, namespaces)
			: Promise.resolve<SerialisableBundle>({}),
		// Sent for every locale, not just the pre-loaded namespaces: a Client
		// Component may ask for one the server did not send, and it needs the
		// hash to fetch a cacheable URL.
		readLocaleManifest(locale),
	]);

	// Anything already in the payload has nothing to preload, and preloading it
	// anyway would fetch a file the browser will never ask for — which the
	// console reports as an unused preload, correctly.
	const preload = [...new Set(prefetch)].filter((namespace) => messages[namespace] === undefined);

	return (
		<>
			{preload.map((namespace) => (
				<link
					key={namespace}
					rel="preload"
					as="fetch"
					// Required even though the request is same-origin. A preload
					// without it carries different credentials than the `fetch()` the
					// client makes, so the browser refuses to reuse it: the file is
					// downloaded twice and the console reports the preload as unused.
					// Chrome says so outright — "the request credentials mode does not
					// match" — which is how this was caught.
					crossOrigin="anonymous"
					href={namespaceUrl(config, locale, namespace, manifest[namespace])}
					// It is for something that will be needed shortly, not for the page
					// itself: it should not compete with what is being rendered now.
					fetchPriority="low"
				/>
			))}
			<I18nClientProvider
				locale={locale}
				config={config}
				messages={messages}
				manifest={manifest}
			>
				{children}
			</I18nClientProvider>
		</>
	);
}

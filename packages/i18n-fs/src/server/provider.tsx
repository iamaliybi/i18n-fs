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
import { getI18nConfig } from './config.js';
import { getLocale } from './locale.js';
import { readRawNamespaces } from './messages.js';

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
	locale: explicitLocale,
	children,
}: I18nProviderProps) {
	const config = await getI18nConfig();
	const locale = explicitLocale ?? (await getLocale());

	const messages = namespaces.length
		? await readRawNamespaces(config, locale, namespaces)
		: {};

	return (
		<I18nClientProvider locale={locale} config={config} messages={messages}>
			{children}
		</I18nClientProvider>
	);
}

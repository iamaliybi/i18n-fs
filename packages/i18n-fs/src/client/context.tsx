'use client';

/**
 * The client-side i18n context.
 *
 * Everything a Client Component needs about the active language lives here: the
 * locale itself, the configuration, and whatever messages the server already
 * sent. It is populated once per full page load from values the server derived
 * from the request, which is what the requirement to read headers and cookies
 * on every refresh amounts to in the App Router.
 *
 * The hooks that read it arrive with the client layer; this file exists now
 * because the server provider has to render into something.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ResolvedI18nFsConfig } from '../config.js';

/** Raw namespace contents, as parsed JSON, keyed by namespace. */
export type MessagePayload = Record<string, unknown>;

/** What the provider makes available. */
export interface I18nContextValue {
	locale: string;
	config: ResolvedI18nFsConfig;
	/** Namespaces the server rendered with, so the client does not refetch them. */
	messages: MessagePayload;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** Props of {@link I18nClientProvider}. */
export interface I18nClientProviderProps extends I18nContextValue {
	children: ReactNode;
}

/**
 * Holds the active locale for the client tree.
 *
 * Rendered by the server `I18nProvider`; an application does not normally use
 * it directly.
 */
export function I18nClientProvider({
	locale,
	config,
	messages,
	children,
}: I18nClientProviderProps) {
	// The value is rebuilt only when the locale actually changes, so switching
	// language re-renders consumers and navigation within a locale does not.
	const value = useMemo<I18nContextValue>(
		() => ({ locale, config, messages }),
		[locale, config, messages],
	);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * The i18n context, or `null` outside a provider.
 *
 * Prefer {@link useI18nContext}, which explains what to do about it.
 */
export function useOptionalI18nContext(): I18nContextValue | null {
	return useContext(I18nContext);
}

/** The i18n context. Throws with an actionable message outside a provider. */
export function useI18nContext(): I18nContextValue {
	const value = useContext(I18nContext);

	if (!value) {
		throw new Error(
			'[i18n-fs] No I18nProvider found. Render <I18nProvider> from "i18n-fs/server" ' +
				'in your root layout, above any component that reads a translation.',
		);
	}

	return value;
}

/** The active locale. */
export function useLocale(): string {
	return useI18nContext().locale;
}

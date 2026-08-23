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
	/**
	 * Content hash per namespace for this locale, from `.i18n-fs/manifest.json`.
	 *
	 * Files under `public/` are served verbatim and are not fingerprinted, so
	 * this is what lets a fetched namespace be cached immutably and still change
	 * when the content does.
	 */
	manifest: Record<string, string>;
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
	manifest,
	children,
}: I18nClientProviderProps) {
	// What a provider higher up already sent, if there is one.
	//
	// A nested provider used to replace this outright, which meant a subtree had
	// to re-list every namespace its parent had already inlined into the HTML —
	// and forgetting one did not fail. It fetched the file over the network
	// instead, the same bytes the document already carried, and during server
	// rendering that fetch has no origin so the component rendered its fallback.
	//
	// Extending is what a reader expects from nesting, and it is what makes
	// putting a provider on one route a size optimisation rather than a trap.
	const outer = useOptionalI18nContext();

	// The value is rebuilt only when something in it actually changes, so
	// switching language re-renders consumers and navigating within a locale
	// does not.
	const value = useMemo<I18nContextValue>(() => {
		// Only from a provider for the same locale. Two locales in one tree is
		// unusual, but inheriting Persian messages into an English subtree would
		// be worse than making it re-list them.
		const inherits = outer !== null && outer.locale === locale;

		return {
			locale,
			config,
			// The inner provider wins on any namespace both send, which is what
			// makes overriding one for a section possible.
			messages: inherits ? { ...outer.messages, ...messages } : messages,
			manifest: inherits ? { ...outer.manifest, ...manifest } : manifest,
		};
	}, [locale, config, messages, manifest, outer]);

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

'use client';

/**
 * `i18n-fs/client` — the Client Component layer.
 *
 * A separate entry point because `'use client'` marks a boundary the bundler
 * has to see. If the server provider imported this module's source directly,
 * the bundler would inline it into the server chunk and the boundary would be
 * gone; importing it by package path keeps it a real module.
 *
 * The translation hooks arrive with the client layer. What is here now is what
 * the server provider needs to render into.
 */

export {
	I18nClientProvider,
	useI18nContext,
	useLocale,
	useOptionalI18nContext,
	type I18nClientProviderProps,
	type I18nContextValue,
	type MessagePayload,
} from './context.js';

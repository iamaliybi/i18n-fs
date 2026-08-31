'use client';

/**
 * `i18n-fs/client` — the Client Component layer.
 *
 * A separate entry point because `'use client'` marks a boundary the bundler
 * has to see. If the server provider imported this module's source directly,
 * the bundler would inline it into the server chunk and the boundary would be
 * gone; importing it by package path keeps it a real module.
 *
 * What is exported here is what an application uses. The loading and caching
 * machinery behind `useTranslation` is deliberately not: every exported name is
 * a promise to keep, and those were never meant to be called from outside.
 * Navigation lives in `i18n-fs/navigation`.
 */

export { useTranslation } from './useTranslation.js';

export { usePrefetch } from './prefetch.js';

export { useFormatter } from './useFormatter.js';

export { createFormatter, type Formatter, type RelativeTimeOptions } from '../formatter.js';

export {
	ERROR_CODE_NAMES,
	ErrorCode,
	errorCodeName,
	isErrorCode,
	isLookupError,
	isNamespaceError,
} from '../errors.js';

export { unknownKey } from '../registry.js';

export type {
	NamespaceState,
	RichTranslationParams,
	TagRenderers,
	TranslateOptions,
	TranslationParams,
	Translator,
} from '../translator.js';

export {
	I18nClientProvider,
	useI18nContext,
	useLocale,
	type I18nClientProviderProps,
	type I18nContextValue,
	type MessagePayload,
} from './context.js';

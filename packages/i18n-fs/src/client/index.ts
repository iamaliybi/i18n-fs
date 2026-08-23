'use client';

/**
 * `i18n-fs/client` — the Client Component layer.
 *
 * A separate entry point because `'use client'` marks a boundary the bundler
 * has to see. If the server provider imported this module's source directly,
 * the bundler would inline it into the server chunk and the boundary would be
 * gone; importing it by package path keeps it a real module.
 */

export { useTranslation, resetClientReporter } from './useTranslation.js';

export {
	ERROR_CODE_NAMES,
	ErrorCode,
	errorCodeName,
	isErrorCode,
	isLookupError,
	isNamespaceError,
} from '../errors.js';

export {
	Link,
	usePathname,
	useRouter,
	useLocaleSwitcher,
	type LinkProps,
	type LocaleRouter,
	type LocaleSwitcher,
} from './navigation.js';

export {
	clearNamespaceCache,
	hasNamespace,
	loadClientNamespace,
	namespaceUrl,
	seedNamespace,
	stateFromPayload,
} from './namespaces.js';

export type {
	NamespaceState,
	TagRenderers,
	TranslateOptions,
	TranslationParams,
	Translator,
} from '../translator.js';

export {
	I18nClientProvider,
	useI18nContext,
	useLocale,
	useOptionalI18nContext,
	type I18nClientProviderProps,
	type I18nContextValue,
	type MessagePayload,
} from './context.js';

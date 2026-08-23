/**
 * `i18n-fs/server` — the Server Component layer.
 *
 * Everything here runs on the server: it reads request headers and the
 * filesystem, neither of which exists in the browser. Importing it from a
 * Client Component is a build error, which is the intent.
 */

export { configureI18n, getI18nConfig, resetI18nConfig } from './config.js';

export {
	getLocale,
	getResolvedLocale,
	getRequestLocale,
	setRequestLocale,
	resolveLocaleFromRequest,
	LOCALE_HEADER,
	type RequestSignals,
	type ResolvedLocale,
	type ServerLocaleSource,
} from './locale.js';

export {
	clearMessageCache,
	isSafeNamespace,
	loadNamespace,
	loadNamespaces,
	namespacePath,
	readLocaleManifest,
	readManifest,
	readRawNamespaces,
	type LocaleManifest,
	type MessageBundle,
	type SerialisableBundle,
} from './messages.js';

export { getTranslation, resetReporter } from './translation.js';

export {
	ERROR_CODE_NAMES,
	ErrorCode,
	errorCodeName,
	isErrorCode,
	isLookupError,
	isNamespaceError,
} from '../errors.js';

export { I18nProvider, type I18nProviderProps } from './provider.js';

export { getPathname, permanentRedirect, redirect } from './navigation.js';

export type {
	NamespaceState,
	TagRenderers,
	TranslateOptions,
	TranslationParams,
	Translator,
} from '../translator.js';

/**
 * `i18n-fs/server` — the Server Component layer.
 *
 * Everything here runs on the server: it reads request headers and the
 * filesystem, neither of which exists in the browser. Importing it from a
 * Client Component is a build error, which is the intent.
 *
 * What is exported is what an application uses, plus the four lower-level
 * loaders the documentation offers for tooling. The rest — cache resets, path
 * builders, the locale resolver — is internal: every exported name is a promise
 * to keep, and nothing outside this package ever called them.
 */

export { configureI18n, getI18nConfig } from './config.js';

export {
	getLocale,
	getResolvedLocale,
	setRequestLocale,
	LOCALE_HEADER,
	type ResolvedLocale,
} from './locale.js';

// Lower-level loading, documented for tooling that wants the messages without
// the translator around them.
export {
	loadNamespace,
	loadNamespaces,
	readManifest,
	readRawNamespaces,
	type LocaleManifest,
	type MessageBundle,
	type SerialisableBundle,
} from './messages.js';

export { getTranslation } from './translation.js';

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

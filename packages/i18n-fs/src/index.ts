/**
 * `i18n-fs` — folder-based i18n for Next.js with a Rust core.
 *
 * This entry holds what both layers share: the configuration contract, the
 * error codes, the types, and the core loaders. Nothing here is tied to the
 * server or the browser, so importing a type from it costs a client bundle
 * nothing.
 *
 * The layers have their own entries, and neither can reach the other:
 *
 * - `i18n-fs/server`     — `getTranslation`, `getLocale`, `I18nProvider`, `redirect`
 * - `i18n-fs/client`     — `useTranslation`, `useLocale`, `usePrefetch`
 * - `i18n-fs/navigation` — `Link`, `useRouter`, `usePathname`, `useLocaleSwitcher`
 * - `i18n-fs/proxy`      — `createI18nProxy` (`i18n-fs/middleware` under the
 *   Next.js 14–15 name)
 * - `i18n-fs/config`     — `defineConfig`
 */

export { loadCore, loadMessageCore, loadFullCore, hasMessageSupport } from './core/index.js';

export { VERSION } from './version.js';

export {
	ERROR_CODE_NAMES,
	ErrorCode,
	errorCodeName,
	isErrorCode,
	isLookupError,
	isNamespaceError,
} from './errors.js';

export type {
	Action,
	ConfigIssue,
	Decision,
	I18nErrorPayload,
	Interpolation,
	LocaleSource,
	MessageNode,
	RequestInfo,
	Store,
	EdgeCore,
	FullCore,
	MessageCore,
} from './core/types.js';

export {
	CONFIG_DEFAULTS,
	defineConfig,
	type CookieConfig,
	type DomainRule,
	type I18nFsConfig,
	type PrefixMode,
	type ResolvedI18nFsConfig,
	type RoutingStrategy,
} from './config.js';

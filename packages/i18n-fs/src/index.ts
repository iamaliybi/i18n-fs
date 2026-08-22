/**
 * `i18n-fs` — folder-based i18n for Next.js with a Rust core.
 *
 * This entry point currently exposes the configuration contract and the core
 * loader. The React and Next.js layers land in later pull requests:
 *
 * - `i18n-fs/server`     — `getLocale`, `getTranslation`, `I18nProvider`
 * - `i18n-fs`            — `useTranslation`, `useLocale`
 * - `i18n-fs/navigation` — `Link`, `useRouter`, `usePathname`, `redirect`
 * - `i18n-fs/middleware` — the locale-resolving middleware
 *
 * They are not exported as stubs on purpose: an import that type-checks and
 * then throws at runtime is worse than one that fails to resolve.
 */

export { loadCore, loadFullCore, hasMessageSupport } from './core/index.js';

export type {
	Action,
	ConfigIssue,
	Decision,
	ErrorCode,
	I18nErrorPayload,
	Interpolation,
	LocaleSource,
	MessageNode,
	RequestInfo,
	Store,
	EdgeCore,
	FullCore,
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

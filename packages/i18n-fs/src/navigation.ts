'use client';

/**
 * `i18n-fs/navigation` — locale-aware navigation for Client Components.
 *
 * A re-export of the client entry rather than of the source modules. With one
 * entry per bundle and no code splitting, importing the source here would give
 * this entry its own copy of the React context — and a `<Link>` would then read
 * a different context than the provider populated, which surfaces as
 * "No I18nProvider found" on a page that plainly has one.
 */

export {
	Link,
	usePathname,
	useRouter,
	useLocaleSwitcher,
	useLocale,
	type LinkProps,
	type LocaleRouter,
	type LocaleSwitcher,
} from 'i18n-fs/client';

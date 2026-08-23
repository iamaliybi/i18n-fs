'use client';

/**
 * `i18n-fs/navigation` — locale-aware navigation for Client Components.
 *
 * The canonical home for `<Link>`, `useRouter`, `usePathname` and
 * `useLocaleSwitcher`. They used to be re-exported from `i18n-fs/client` as
 * well, which meant two import paths for one thing and no answer to which was
 * right.
 *
 * The implementation is bundled here rather than re-exported, and it reaches
 * the React context through `i18n-fs/client` — see the note in
 * `client/navigation.tsx`. There is one context module, and this entry does not
 * contain it; CI asserts that by counting `createContext` in the built file.
 */

export {
	Link,
	usePathname,
	useRouter,
	useLocaleSwitcher,
	type LinkProps,
	type LocaleRouter,
	type LocaleSwitcher,
} from './client/navigation.js';

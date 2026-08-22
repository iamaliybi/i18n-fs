'use client';

/**
 * Locale-aware wrappers around Next.js navigation.
 *
 * They take locale-free paths — `/about`, not `/en/about` — and apply the
 * active locale on the way out. Application code stops thinking about prefixes,
 * and switching the routing strategy in `i18n-fs.config.ts` does not touch a
 * single `href`.
 *
 * No factory and no configuration argument: the locale and the config are
 * already in context, put there by the provider from the request.
 */

import NextLink from 'next/link';
import {
	usePathname as useNextPathname,
	useRouter as useNextRouter,
	useSearchParams,
} from 'next/navigation';
import { useCallback, useMemo, type ComponentProps } from 'react';
import { localePath, stripLocale } from '../paths.js';
import { useI18nContext } from './context.js';

/** Turn a locale-free href into the public path for a locale. */
function useLocalise(): (href: string, locale?: string) => string {
	const { config, locale } = useI18nContext();

	return useCallback(
		(href: string, target?: string) =>
			localePath(
				config,
				href,
				target ?? locale,
				typeof window === 'undefined' ? undefined : window.location.host,
			),
		[config, locale],
	);
}

/** Props of {@link Link}. */
export type LinkProps = Omit<ComponentProps<typeof NextLink>, 'href'> & {
	/** A locale-free path, e.g. `/about`. */
	href: string;
	/** Link to a locale other than the active one. */
	locale?: string;
};

/**
 * `next/link` with the active locale applied.
 *
 * Anything that is not one of our paths — an absolute URL, a fragment, a
 * `mailto:` — passes through untouched.
 */
export function Link({ href, locale, ...rest }: LinkProps) {
	const localise = useLocalise();
	return <NextLink href={localise(href, locale)} {...rest} />;
}

/** The current path with the locale prefix removed. */
export function usePathname(): string {
	const { config } = useI18nContext();
	const pathname = useNextPathname();

	// Locale-free, so a component can compare against `/about` regardless of
	// which prefix mode the application is configured for.
	return useMemo(() => stripLocale(config, pathname ?? '/'), [config, pathname]);
}

/** What {@link useRouter} returns. */
export interface LocaleRouter {
	push(href: string, options?: { locale?: string; scroll?: boolean }): void;
	replace(href: string, options?: { locale?: string; scroll?: boolean }): void;
	back(): void;
	forward(): void;
	refresh(): void;
	prefetch(href: string, options?: { locale?: string }): void;
}

/** `next/navigation`'s router, taking locale-free paths. */
export function useRouter(): LocaleRouter {
	const router = useNextRouter();
	const localise = useLocalise();

	return useMemo<LocaleRouter>(
		() => ({
			push: (href, options) =>
				router.push(localise(href, options?.locale), { scroll: options?.scroll ?? true }),
			replace: (href, options) =>
				router.replace(localise(href, options?.locale), { scroll: options?.scroll ?? true }),
			back: () => router.back(),
			forward: () => router.forward(),
			refresh: () => router.refresh(),
			prefetch: (href, options) => router.prefetch(localise(href, options?.locale)),
		}),
		[router, localise],
	);
}

/** What {@link useLocaleSwitcher} returns. */
export interface LocaleSwitcher {
	/** The active locale. */
	locale: string;
	/** Every configured locale, in configuration order. */
	locales: string[];
	/** Switch to `locale`. Reloads the page. */
	switchTo(locale: string): void;
	/** The URL `switchTo` would navigate to, for rendering real links. */
	hrefFor(locale: string): string;
}

/**
 * Switch the active language.
 *
 * The switch is a **full page load**, not a client transition. Every layout and
 * Server Component above the switcher was rendered in the old locale, and only
 * a fresh request re-runs them — a soft navigation would leave half the page in
 * the previous language.
 *
 * Under the domain strategy the target locale may live on another hostname, so
 * the URL is absolute in that case.
 */
export function useLocaleSwitcher(): LocaleSwitcher {
	const { config, locale } = useI18nContext();
	const pathname = useNextPathname();
	const searchParams = useSearchParams();

	const hrefFor = useCallback(
		(target: string): string => {
			const query = searchParams?.toString();
			const path =
				localePath(
					config,
					pathname ?? '/',
					target,
					typeof window === 'undefined' ? undefined : window.location.host,
				) + (query ? `?${query}` : '');

			if (config.strategy !== 'domain') return path;

			const domain = config.domains.find(
				(rule) => rule.locale.toLowerCase() === target.toLowerCase(),
			);
			const current =
				typeof window === 'undefined' ? undefined : window.location.host.split(':')[0];

			// Only leave the current origin when the locale genuinely lives
			// elsewhere; otherwise a same-site switch would needlessly become a
			// cross-origin one.
			if (!domain || domain.domain.toLowerCase() === current?.toLowerCase()) return path;

			return `https://${domain.domain}${path}`;
		},
		[config, pathname, searchParams],
	);

	const switchTo = useCallback(
		(target: string): void => {
			// The cookie is written here as well as by the middleware, so the
			// choice survives even under a configuration where the URL cannot
			// express it.
			document.cookie = [
				`${config.cookie.name}=${encodeURIComponent(target)}`,
				`Max-Age=${config.cookie.maxAge}`,
				`Path=${config.cookie.path}`,
				`SameSite=${config.cookie.sameSite}`,
				config.cookie.secure ? 'Secure' : '',
			]
				.filter(Boolean)
				.join('; ');

			window.location.assign(hrefFor(target));
		},
		[config, hrefFor],
	);

	return useMemo(
		() => ({ locale, locales: config.locales, switchTo, hrefFor }),
		[locale, config.locales, switchTo, hrefFor],
	);
}

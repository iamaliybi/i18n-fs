/**
 * Locale-aware redirects for Server Components, Server Actions and handlers.
 *
 * The client wrappers live in `i18n-fs/navigation`; these are here because they
 * need the request's locale, which only the server can read.
 */

import { getI18nConfig } from './config.js';
import { getLocale } from './locale.js';
import { localePath } from '../paths.js';

/** The public path for a locale-free href, in the request's locale. */
export async function getPathname(href: string, locale?: string): Promise<string> {
	const config = await getI18nConfig();
	return localePath(config, href, locale ?? (await getLocale()));
}

/**
 * `next/navigation`'s `redirect`, taking a locale-free path.
 *
 * Like the original it never returns: it throws the control-flow error Next
 * uses to unwind the render.
 */
export async function redirect(href: string, locale?: string): Promise<never> {
	const { redirect: nextRedirect } = await import('next/navigation');
	return nextRedirect(await getPathname(href, locale));
}

/** As {@link redirect}, but a permanent one. */
export async function permanentRedirect(href: string, locale?: string): Promise<never> {
	const { permanentRedirect: nextPermanentRedirect } = await import('next/navigation');
	return nextPermanentRedirect(await getPathname(href, locale));
}

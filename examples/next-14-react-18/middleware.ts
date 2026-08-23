import { createI18nMiddleware } from 'i18n-fs/middleware';
import i18nConfig from './.i18n-fs/config.mjs';

// Next.js 14 and 15 use the `middleware` file convention. Next.js 16 renamed
// it to `proxy` and deprecated this one; `createI18nMiddleware` is the same
// function under its older name. See examples/next-16-proxy.
export default createI18nMiddleware(i18nConfig);

export const config = {
	// Written out literally on purpose: Next.js reads this by static analysis
	// at build time and rejects an imported identifier.
	//
	// The double backslash matters. '\.' in a JavaScript string is just '.',
	// which turns the file-extension exclusion into "any character" and stops
	// the middleware running on every path but the root.
	matcher: ['/((?!_next/|api/|.*\\.[^/]*$).*)'],
};

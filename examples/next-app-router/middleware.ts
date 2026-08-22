import { createI18nMiddleware } from 'i18n-fs/middleware';
import i18nConfig from './.i18n-fs/config.mjs';

export default createI18nMiddleware(i18nConfig);

export const config = {
	// Written out literally on purpose: Next.js reads this by static analysis at
	// build time and rejects an imported identifier.
	//
	// The double backslash matters. `'\.'` in a JavaScript string is just `.`,
	// so a single one turns the file-extension exclusion into "any character"
	// and the middleware silently stops running on every path but `/`.
	matcher: ['/((?!_next/|api/|.*\\.[^/]*$).*)'],
};

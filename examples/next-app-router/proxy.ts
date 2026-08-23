import { createI18nProxy } from 'i18n-fs/proxy';
import i18nConfig from './.i18n-fs/config.mjs';

export default createI18nProxy(i18nConfig);

export const config = {
	// Written out literally on purpose: Next.js reads this by static analysis
	// at build time and rejects an imported identifier.
	//
	// The double backslash matters. '\.' in a JavaScript string is just '.',
	// which turns the file-extension exclusion into "any character" and stops
	// the proxy running on every path but the root.
	matcher: ['/((?!_next/|api/|.*\\.[^/]*$).*)'],
};

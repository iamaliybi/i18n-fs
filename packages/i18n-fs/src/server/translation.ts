/**
 * `getTranslation` — the server counterpart of `useTranslation`.
 *
 * Async because it loads the namespace; everything after that is the shared
 * translator, so a lookup behaves identically on the server and in the browser.
 */

import { loadFullCore } from '../core/index.js';
import { createReporter, type Reporter } from '../report.js';
import { createTranslator, type Translator } from '../translator.js';
import { getI18nConfig } from './config.js';
import { getLocale } from './locale.js';
import { loadNamespace } from './messages.js';

let reporter: Reporter | undefined;
let reporterDebug: boolean | undefined;

/**
 * One reporter per process, so de-duplication actually de-duplicates.
 *
 * A per-call reporter would log the same missing key on every render, which is
 * the noise the de-duplication exists to prevent.
 */
function getReporter(debug: boolean): Reporter {
	if (!reporter || reporterDebug !== debug) {
		reporter = createReporter(debug);
		reporterDebug = debug;
	}
	return reporter;
}

/**
 * A translator for one namespace, in the request's locale.
 *
 * ```ts
 * const t = await getTranslation('home/hero', 'cta');
 * t('label');
 * ```
 *
 * The first argument is the file beneath the locale directory; the second is an
 * object inside it.
 */
export async function getTranslation(namespace: string, scope?: string): Promise<Translator> {
	const [config, core, locale] = await Promise.all([
		getI18nConfig(),
		loadFullCore(),
		getLocale(),
	]);

	return createTranslator({
		core,
		locale,
		namespace,
		scope,
		state: await loadNamespace(config, locale, namespace),
		report: getReporter(config.debug),
	});
}

/** Reset the shared reporter. Exposed for tests. */
export function resetReporter(): void {
	reporter = undefined;
	reporterDebug = undefined;
}

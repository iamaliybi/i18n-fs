'use client';

/**
 * `useTranslation` — the Client Component hook.
 *
 * ```ts
 * const t = useTranslation('home/hero', 'cta');
 * t('label');
 * ```
 *
 * The first argument is the file beneath the locale directory, the second an
 * object inside it. Both arguments and the return value match
 * `getTranslation`, and the lookup itself is the same shared translator, so a
 * message cannot render one way during SSR and another after hydration.
 *
 * A namespace the server already sent resolves without suspending. Anything
 * else suspends on a module-scoped promise — see `namespaces.ts` for why the
 * cache has to live there.
 */

import { use, useMemo } from 'react';
import { loadMessageCore } from '../core/index.js';
import { createReporter, type Reporter } from '../report.js';
import { createTranslator, type Translator } from '../translator.js';
import { useI18nContext } from './context.js';
import { loadClientNamespace, hasNamespace, seedNamespace, stateFromPayload } from './namespaces.js';

let reporter: Reporter | undefined;
let reporterDebug: boolean | undefined;

/**
 * One reporter for the whole page.
 *
 * Per-hook reporters would each keep their own "already logged" set, so a
 * missing key used in five components would be logged five times — and again
 * on every remount.
 */
function getReporter(debug: boolean): Reporter {
	if (!reporter || reporterDebug !== debug) {
		reporter = createReporter(debug);
		reporterDebug = debug;
	}
	return reporter;
}

/**
 * A translator for one namespace, in the active locale.
 *
 * Suspends while a namespace the server did not send is being fetched, so a
 * `<Suspense>` boundary above the component controls what is shown meanwhile.
 */
export function useTranslation(namespace: string, scope?: string): Translator {
	const { locale, config, messages, manifest } = useI18nContext();

	// Reading the core through `use()` rather than awaiting it keeps the hook
	// synchronous. The promise is stable, so this suspends at most once per page.
	const core = use(loadMessageCore());

	// A namespace the server sent is turned into a store once and seeded into
	// the same cache the fetching path uses, so both routes agree and a later
	// component reading it does not suspend.
	if (!hasNamespace(locale, namespace) && messages[namespace] !== undefined) {
		seedNamespace(locale, namespace, stateFromPayload(core, locale, namespace, messages[namespace]));
	}

	const state = use(loadClientNamespace(config, locale, namespace, manifest[namespace]));

	return useMemo(
		() =>
			createTranslator({
				core,
				locale,
				namespace,
				scope,
				state,
				report: getReporter(config.debug),
			}),
		[core, locale, namespace, scope, state, config.debug],
	);
}

/** Reset the shared reporter. Exposed for tests. */
export function resetClientReporter(): void {
	reporter = undefined;
	reporterDebug = undefined;
}

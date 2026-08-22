/**
 * Developer diagnostics.
 *
 * Every lookup failure falls back the same way — the developer's string, or the
 * key. What differs is what gets logged, and that is the whole point: the
 * reader sees something sensible while the developer sees precisely which of
 * "file missing", "file malformed", "scope absent", "key absent" and "wrong
 * shape" actually happened.
 */

import type { ErrorCode, I18nErrorPayload } from './core/types.js';

/** Human-readable wording per code, kept in one place. */
const WORDING: Record<ErrorCode, (error: I18nErrorPayload) => string> = {
	NAMESPACE_NOT_FOUND: (e) => `could not load namespace "${e.namespace}" for locale "${e.locale}"`,
	INVALID_JSON: (e) => `namespace "${e.namespace}" for locale "${e.locale}" is not valid JSON`,
	SCOPE_NOT_FOUND: (e) =>
		`scope "${e.scope ?? ''}" does not exist in "${e.namespace}" for locale "${e.locale}"`,
	KEY_NOT_FOUND: (e) => `key "${path(e)}" does not exist in "${e.namespace}" for locale "${e.locale}"`,
	TYPE_MISMATCH: (e) => `key "${path(e)}" in "${e.namespace}" has an unexpected type`,
	PARAM_MISSING: (e) => `message "${path(e)}" in "${e.namespace}" expects a parameter that was not provided`,
	INVALID_CONFIG: () => 'the i18n-fs configuration is invalid',
};

function path(error: I18nErrorPayload): string {
	return [error.scope, error.key].filter(Boolean).join('.');
}

/** Stable identity for a diagnostic, so each distinct problem is logged once. */
export function dedupeKey(error: I18nErrorPayload): string {
	return `${error.code}|${error.locale}|${error.namespace}|${path(error)}`;
}

/** Render a diagnostic the way it appears in the console. */
export function formatError(error: I18nErrorPayload): string {
	const describe = WORDING[error.code] ?? (() => 'lookup failed');
	const detail = error.detail ? ` (${error.detail})` : '';

	return `[i18n-fs] ${error.code}: ${describe(error)}.${detail}`;
}

/** Reports each distinct problem once. */
export interface Reporter {
	(error: I18nErrorPayload): void;
	/** Number of distinct problems seen. Used by tests. */
	readonly seen: ReadonlySet<string>;
}

/**
 * Build a reporter.
 *
 * De-duplication is not cosmetic: a missing key in a component that re-renders
 * on every keystroke would otherwise fill the console and hide everything else.
 *
 * Silent outside debug mode. A production page should not narrate its own
 * content gaps to whoever opens the console.
 */
export function createReporter(
	debug: boolean,
	sink: (message: string) => void = console.error,
): Reporter {
	const seen = new Set<string>();

	const report = ((error: I18nErrorPayload): void => {
		if (!debug) return;

		const key = dedupeKey(error);
		if (seen.has(key)) return;
		seen.add(key);

		sink(formatError(error));
	}) as { (error: I18nErrorPayload): void; seen: ReadonlySet<string> };

	Object.defineProperty(report, 'seen', { get: () => seen });

	return report as Reporter;
}

/** A reporter that records nothing and says nothing. */
export const silentReporter: Reporter = createReporter(false);

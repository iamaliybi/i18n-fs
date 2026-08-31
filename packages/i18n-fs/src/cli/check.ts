/**
 * The `check` command.
 *
 * Because `i18n-fs` never falls back to another locale's content, a key missing
 * from one locale is invisible until a user in that locale hits the page. This
 * is where that becomes a build failure instead.
 *
 * The default locale is the reference. Every other locale is compared against
 * it — by key *and* by shape, since a key that is a string in one locale and a
 * list in another passes a name-only comparison and then breaks `t.array`.
 *
 * That comparison assumes the locales are translations of one another, which is
 * usually true and sometimes not: a site whose German pages are written for a
 * German audience rather than translated from the English ones has different
 * keys on purpose. `compareLocales: false` turns the comparison off — and only
 * the comparison. Malformed JSON, an empty namespace and a directory for a
 * locale that is not configured are statements about one file, and are still
 * reported.
 */

import type { ResolvedI18nFsConfig } from '../config.js';
import { ErrorCode, errorCodeName } from '../errors.js';
import type { CliCore, I18nErrorPayload, NamespaceEntry } from '../core/types.js';
import type { MessageFile, ScanResult } from './scan.js';

/** How serious a finding is. */
export type Severity = 'error' | 'warning';

/** One thing the check found. */
export interface Finding {
	severity: Severity;
	/** Stable machine-readable identifier, for `--json` consumers. */
	code: string;
	message: string;
	/** File the finding is about, relative to the project root. */
	file?: string;
	/** Extra lines printed beneath the message, e.g. the first missing keys. */
	details?: string[];
}

/** A parsed namespace, keyed for comparison. */
export interface Parsed {
	file: MessageFile;
	entries: Map<string, NamespaceEntry['kind']>;
	/** Every scope in the file, sorted, with the root as an empty string. */
	scopes: string[];
}

const MAX_LISTED = 10;

/**
 * Drop paths whose ancestor is already in the set.
 *
 * A locale missing a whole list is one problem, not one per element. Reporting
 * `bullets`, `bullets.0` and `bullets.1` separately buries the actionable line
 * in its own consequences.
 */
function shallowest(paths: string[]): string[] {
	const all = new Set(paths);

	return paths.filter((path) => {
		const parts = path.split('.');
		for (let i = 1; i < parts.length; i += 1) {
			if (all.has(parts.slice(0, i).join('.'))) return false;
		}
		return true;
	});
}

function list(items: string[]): string[] {
	const shown = items.slice(0, MAX_LISTED);
	if (items.length > MAX_LISTED) {
		shown.push(`... and ${items.length - MAX_LISTED} more`);
	}
	return shown;
}

/**
 * Run every check.
 *
 * Returns findings rather than printing or throwing, so `build` can reuse the
 * same analysis and the `--json` output is the same data the text output shows.
 */
export function check(
	core: CliCore,
	config: ResolvedI18nFsConfig,
	scanned: ScanResult,
	/**
	 * Whether to compare the locales against each other. Defaults to the
	 * configured value; the CLI passes an explicit one for
	 * `--compare-locales`, which answers the question once without editing the
	 * configuration to do it.
	 */
	compare: boolean = config.compareLocales,
): { findings: Finding[]; parsed: Parsed[] } {
	const findings: Finding[] = [];

	for (const issue of core.validateConfig(config)) {
		findings.push({
			severity: 'error',
			code: 'INVALID_CONFIG',
			message: `${issue.field}: ${issue.message}`,
		});
	}

	for (const locale of scanned.missingLocales) {
		findings.push({
			severity: 'error',
			code: 'LOCALE_DIRECTORY_MISSING',
			message: `No message directory for locale "${locale}".`,
			details: [`Expected ${scanned.root.replace(/\\/g, '/')}/${locale}`],
		});
	}

	for (const locale of scanned.unknownLocales) {
		findings.push({
			severity: 'warning',
			code: 'LOCALE_DIRECTORY_UNKNOWN',
			message: `Directory "${locale}" is not a configured locale and will never be served.`,
		});
	}

	// Parse everything first. A file that does not parse is reported once, here,
	// and then excluded from the comparisons below so one broken file does not
	// also produce a missing-key finding for every key it contains.
	const parsed: Parsed[] = [];
	const unparsed = new Set<string>();

	for (const file of scanned.files) {
		let store;

		try {
			store = new core.Store(file.locale, file.namespace, file.raw);
		} catch (error) {
			const payload = error as I18nErrorPayload;
			findings.push({
				severity: 'error',
				// Findings use names rather than the runtime's numbers: this output
				// is read by people, and `--json` consumers match on stable
				// identifiers shared with the CLI's own diagnostics.
				code: errorCodeName(payload.code ?? ErrorCode.InvalidJson),
				message: `${file.locale}/${file.namespace}: ${payload.detail ?? 'could not be parsed'}`,
				file: file.displayPath,
			});
			unparsed.add(`${file.locale}\u0000${file.namespace}`);
			continue;
		}

		try {
			const entries = new Map(store.entries().map((entry) => [entry.key, entry.kind]));
			const scopes = store.scopes();

			if (entries.size === 0) {
				findings.push({
					severity: 'warning',
					code: 'NAMESPACE_EMPTY',
					message: `${file.locale}/${file.namespace} contains no messages.`,
					file: file.displayPath,
				});
			}

			parsed.push({ file, entries, scopes });
		} finally {
			store.free();
		}
	}

	if (compare) {
		findings.push(...compareLocales(config, parsed, unparsed));
	}

	return { findings, parsed };
}

function compareLocales(
	config: ResolvedI18nFsConfig,
	parsed: Parsed[],
	unparsed: Set<string>,
): Finding[] {
	const findings: Finding[] = [];

	const byLocale = new Map<string, Map<string, Parsed>>();
	for (const item of parsed) {
		let namespaces = byLocale.get(item.file.locale);
		if (!namespaces) {
			namespaces = new Map();
			byLocale.set(item.file.locale, namespaces);
		}
		namespaces.set(item.file.namespace, item);
	}

	const reference = byLocale.get(config.defaultLocale);
	if (!reference) return findings;

	for (const locale of config.locales) {
		if (locale === config.defaultLocale) continue;

		const namespaces = byLocale.get(locale) ?? new Map<string, Parsed>();

		for (const [namespace, source] of reference) {
			const target = namespaces.get(namespace);

			if (!target) {
				// A file that failed to parse is not a missing file; INVALID_JSON
				// already said what is wrong with it.
				if (unparsed.has(`${locale}\u0000${namespace}`)) continue;

				findings.push({
					severity: 'error',
					code: 'NAMESPACE_MISSING',
					message: `Locale "${locale}" has no "${namespace}", which "${config.defaultLocale}" defines.`,
					file: source.file.displayPath,
				});
				continue;
			}

			const absent: string[] = [];
			const mismatched: string[] = [];

			for (const [key, kind] of source.entries) {
				const other = target.entries.get(key);
				if (other === undefined) {
					absent.push(key);
				} else if (other !== kind) {
					mismatched.push(`${key} is ${kind} in ${config.defaultLocale}, ${other} here`);
				}
			}

			const missing = shallowest(absent);
			const extra = shallowest(
				[...target.entries.keys()].filter((key) => !source.entries.has(key)),
			);

			if (missing.length) {
				findings.push({
					severity: 'error',
					code: 'KEYS_MISSING',
					message: `${locale}/${namespace} is missing ${missing.length} key(s) that "${config.defaultLocale}" defines.`,
					file: target.file.displayPath,
					details: list(missing),
				});
			}

			if (mismatched.length) {
				findings.push({
					severity: 'error',
					code: 'KEY_SHAPE_MISMATCH',
					message: `${locale}/${namespace} has ${mismatched.length} key(s) of a different shape.`,
					file: target.file.displayPath,
					details: list(mismatched),
				});
			}

			if (extra.length) {
				findings.push({
					severity: 'warning',
					code: 'KEYS_EXTRA',
					message: `${locale}/${namespace} defines ${extra.length} key(s) that "${config.defaultLocale}" does not. They are unreachable through typed lookups.`,
					file: target.file.displayPath,
					details: list(extra),
				});
			}
		}

		for (const namespace of namespaces.keys()) {
			if (!reference.has(namespace)) {
				findings.push({
					severity: 'warning',
					code: 'NAMESPACE_EXTRA',
					message: `Locale "${locale}" defines "${namespace}", which "${config.defaultLocale}" does not.`,
				});
			}
		}
	}

	return findings;
}

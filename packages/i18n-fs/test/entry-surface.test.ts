/**
 * What each entry point is allowed to export.
 *
 * Every exported name is a promise kept under semver, and the surface had grown
 * to about twice what the documentation describes: cache resets, path builders,
 * the locale resolver, the whole namespace-loading machinery behind
 * `useTranslation`. None of it had a caller — the tests import from `src/`, and
 * the example apps use six names between them — but all of it was public.
 *
 * That is not something a type checker or a runtime test notices, so the sets
 * are pinned here exactly. An unexpected export fails as loudly as a missing
 * one, because an accidental export is the one that becomes permanent.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

/** Every name an entry exports, types included. */
function surface(entry: string): string[] {
	const declaration = `${dist}${entry}.d.ts`;

	if (!existsSync(declaration)) {
		throw new Error(`${entry} is not built — run \`npm run build\` before the tests`);
	}

	const text = readFileSync(declaration, 'utf8');
	const names = new Set<string>();

	for (const block of text.matchAll(/^export \{([^}]*)\}/gm)) {
		for (const part of (block[1] ?? '').split(',')) {
			const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, '');
			if (name) names.add(name);
		}
	}

	for (const match of text.matchAll(/^export declare (?:function|const) (\w+)/gm)) {
		names.add(match[1] ?? '');
	}

	return [...names].filter(Boolean).sort();
}

/** Exported from every entry that can report a failure, for convenience. */
const ERRORS = [
	'ERROR_CODE_NAMES',
	'ErrorCode',
	'errorCodeName',
	'isErrorCode',
	'isLookupError',
	'isNamespaceError',
];

/** The translator's types, wherever a translator is returned. */
const TRANSLATOR = [
	'NamespaceState',
	'TagRenderers',
	'TranslateOptions',
	'TranslationParams',
	'Translator',
];

describe('i18n-fs/client', () => {
	it('exports what a Client Component uses, and nothing else', () => {
		expect(surface('client/index')).toEqual(
			[
				...ERRORS,
				...TRANSLATOR,
				'I18nClientProvider',
				'I18nClientProviderProps',
				'I18nContextValue',
				'MessagePayload',
				'useI18nContext',
				'useLocale',
				'usePrefetch',
				'useTranslation',
			].sort(),
		);
	});

	it('does not carry the loading machinery behind useTranslation', () => {
		// These exist, and are called on every render. They are not an API.
		for (const name of [
			'loadClientNamespace',
			'stateFromPayload',
			'seedNamespace',
			'hasNamespace',
			'clearNamespaceCache',
			'namespaceUrl',
			'prefetchNamespace',
			'resetClientReporter',
		]) {
			expect(surface('client/index'), `${name} should be internal`).not.toContain(name);
		}
	});

	it('leaves navigation to i18n-fs/navigation', () => {
		for (const name of ['Link', 'useRouter', 'usePathname', 'useLocaleSwitcher']) {
			expect(surface('client/index'), `${name} has one home now`).not.toContain(name);
		}
	});
});

describe('i18n-fs/navigation', () => {
	it('is the only home for locale-aware navigation', () => {
		expect(surface('navigation')).toEqual(
			['Link', 'LinkProps', 'LocaleRouter', 'LocaleSwitcher', 'useLocaleSwitcher', 'usePathname', 'useRouter'].sort(),
		);
	});

	it('contains no React context of its own', () => {
		// The failure this prevents is not a type error. A second context means a
		// <Link> reads state the provider never populated, which surfaces as "No
		// I18nProvider found" on a page that plainly has one — at runtime, in the
		// browser, only. The implementation lives here now, so the import that
		// keeps the context single is the thing to assert.
		const built = readFileSync(`${dist}navigation.js`, 'utf8');

		expect(built).not.toContain('createContext');
		expect(built).toContain("from 'i18n-fs/client'");
	});
});

describe('i18n-fs/server', () => {
	it('exports what a Server Component uses, plus the documented loaders', () => {
		expect(surface('server/index')).toEqual(
			[
				...ERRORS,
				...TRANSLATOR,
				'I18nProvider',
				'I18nProviderProps',
				'LOCALE_HEADER',
				'LocaleManifest',
				'MessageBundle',
				'ResolvedLocale',
				'SerialisableBundle',
				'configureI18n',
				'getI18nConfig',
				'getLocale',
				'getPathname',
				'getResolvedLocale',
				'getTranslation',
				'loadNamespace',
				'loadNamespaces',
				'permanentRedirect',
				'readManifest',
				'readRawNamespaces',
				'redirect',
				'setRequestLocale',
			].sort(),
		);
	});

	it('does not carry test helpers or internal plumbing', () => {
		for (const name of [
			'clearMessageCache',
			'resetI18nConfig',
			'resetReporter',
			'resolveLocaleFromRequest',
			'isSafeNamespace',
			'namespacePath',
			'readLocaleManifest',
			'getRequestLocale',
		]) {
			expect(surface('server/index'), `${name} should be internal`).not.toContain(name);
		}
	});
});

describe('the two layers stay apart', () => {
	// The point of separate entries: importing the wrong one is a build error
	// rather than a runtime surprise.
	it('no server API is reachable from the client entry', () => {
		const client = surface('client/index');

		for (const name of ['getTranslation', 'I18nProvider', 'setRequestLocale', 'redirect']) {
			expect(client, `${name} is server-only`).not.toContain(name);
		}
	});

	it('no client hook is reachable from the server entry', () => {
		const server = surface('server/index');

		for (const name of ['useTranslation', 'usePrefetch', 'useLocale', 'useI18nContext']) {
			expect(server, `${name} is a client hook`).not.toContain(name);
		}
	});

	it('the root entry carries the shared types without either layer', () => {
		const root = surface('index');

		expect(root).toContain('ErrorCode');
		expect(root).toContain('VERSION');

		for (const name of ['useTranslation', 'getTranslation', 'I18nProvider', 'Link']) {
			expect(root, `${name} belongs to a layer, not the root`).not.toContain(name);
		}
	});
});

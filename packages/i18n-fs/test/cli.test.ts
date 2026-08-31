/**
 * Tests for the CLI, run against real fixture projects on disk.
 *
 * The scanning, hashing and file writing are the point of this command, so
 * mocking the filesystem would test the mock rather than the tool.
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCliCore } from '../src/core/index.js';
import { buildConfigModule, buildManifest, buildTypes, outputDir, writeArtefacts } from '../src/cli/build.js';
import { check } from '../src/cli/check.js';
import { findConfig, loadConfig, resolveConfig } from '../src/cli/config.js';
import { scan } from '../src/cli/scan.js';
import type { I18nFsConfig } from '../src/config.js';

const core = await loadCliCore();
const created: string[] = [];

afterEach(async () => {
	await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Write a fixture project and return its root. */
async function project(
	config: I18nFsConfig,
	files: Record<string, string>,
	options: { configFile?: string } = {},
): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'i18n-fs-'));
	created.push(root);

	await writeFile(
		join(root, options.configFile ?? 'i18n-fs.config.mjs'),
		`export default ${JSON.stringify(config, null, '\t')};\n`,
		'utf8',
	);

	for (const [path, contents] of Object.entries(files)) {
		const full = join(root, path);
		await mkdir(join(full, '..'), { recursive: true });
		await writeFile(full, contents, 'utf8');
	}

	return root;
}

const BASE: I18nFsConfig = { locales: ['fa', 'en'], defaultLocale: 'fa' };

const HOME_FA = JSON.stringify({
	hero: { title: 'خوش آمدید', bullets: ['سریع', 'کوچک'], cta: { label: 'شروع' } },
});
const HOME_EN = JSON.stringify({
	hero: { title: 'Welcome', bullets: ['Fast', 'Small'], cta: { label: 'Start' } },
});

async function run(root: string) {
	const configPath = findConfig(root);
	if (!configPath) throw new Error('fixture has no config');

	const config = resolveConfig(await loadConfig(configPath));
	const scanned = await scan(root, config);
	return { config, scanned, ...check(core, config, scanned) };
}

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe('config loading', () => {
	it('finds and resolves a config, filling in defaults', async () => {
		const root = await project(BASE, {});
		const config = resolveConfig(await loadConfig(findConfig(root)!));

		expect(config.strategy).toBe('path');
		expect(config.prefix).toBe('as-needed');
		expect(config.messagesDir).toBe('locales');
		expect(config.cookie.name).toBe('I18N_FS_LOCALE');
		expect(config.domains).toEqual([]);
	});

	it('returns undefined when there is no config', async () => {
		const root = await mkdtemp(join(tmpdir(), 'i18n-fs-'));
		created.push(root);
		expect(findConfig(root)).toBeUndefined();
	});

	it('rejects a config with no default export', async () => {
		const root = await mkdtemp(join(tmpdir(), 'i18n-fs-'));
		created.push(root);
		await writeFile(join(root, 'i18n-fs.config.mjs'), 'export const nope = 1;\n', 'utf8');

		await expect(loadConfig(join(root, 'i18n-fs.config.mjs'))).rejects.toThrow(
			/must have a default export/,
		);
	});
});

describe('scanning', () => {
	it('names namespaces by their path beneath the locale directory', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home/hero.json': HOME_FA,
			'public/locales/fa/footer.json': '{"copyright":"x"}',
			'public/locales/en/home/hero.json': HOME_EN,
			'public/locales/en/footer.json': '{"copyright":"x"}',
		});

		const { scanned } = await run(root);
		const namespaces = scanned.files
			.filter((f) => f.locale === 'fa')
			.map((f) => f.namespace)
			.sort();

		expect(namespaces).toEqual(['footer', 'home/hero']);
	});

	it('hashes file contents so the browser can cache immutably', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': HOME_FA,
			'public/locales/en/home.json': HOME_EN,
		});

		const { scanned } = await run(root);
		const fa = scanned.files.find((f) => f.locale === 'fa')!;
		const en = scanned.files.find((f) => f.locale === 'en')!;

		expect(fa.hash).toMatch(/^[0-9a-f]{8}$/);
		expect(fa.hash).not.toBe(en.hash);
	});

	it('reports a configured locale with no directory', async () => {
		const root = await project(BASE, { 'public/locales/fa/home.json': HOME_FA });
		const { scanned } = await run(root);
		expect(scanned.missingLocales).toEqual(['en']);
	});

	it('reports a directory that is not a configured locale', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': HOME_FA,
			'public/locales/en/home.json': HOME_EN,
			'public/locales/de/home.json': '{}',
		});

		const { scanned } = await run(root);
		expect(scanned.unknownLocales).toEqual(['de']);
	});

	it('survives a project with no messages directory at all', async () => {
		const root = await project(BASE, {});
		const { scanned } = await run(root);
		expect(scanned.files).toEqual([]);
		expect(scanned.missingLocales).toEqual(['fa', 'en']);
	});
});

describe('checking', () => {
	it('passes a complete, matching project', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': HOME_FA,
			'public/locales/en/home.json': HOME_EN,
		});

		const { findings } = await run(root);
		expect(findings).toEqual([]);
	});

	it('reports invalid JSON with the parser detail, not a generic failure', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': HOME_FA,
			'public/locales/en/home.json': '{ "hero": ',
		});

		const { findings } = await run(root);
		const invalid = findings.find((f) => f.code === 'INVALID_JSON');

		expect(invalid).toBeDefined();
		expect(invalid!.message).toMatch(/line \d+ column \d+/);
	});

	it('does not also report every key of a file that failed to parse', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': HOME_FA,
			'public/locales/en/home.json': '{ broken',
		});

		const { findings } = await run(root);
		expect(codes(findings)).toContain('INVALID_JSON');
		expect(codes(findings)).not.toContain('KEYS_MISSING');
	});

	it('reports keys the default locale defines and another does not', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': HOME_FA,
			'public/locales/en/home.json': JSON.stringify({ hero: { title: 'Welcome' } }),
		});

		const { findings } = await run(root);
		const missing = findings.find((f) => f.code === 'KEYS_MISSING');

		expect(missing).toBeDefined();
		expect(missing!.details).toContain('hero.cta.label');
		expect(missing!.details).toContain('hero.bullets');
	});

	it('reports a missing list once, not once per element', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': JSON.stringify({ bullets: ['a', 'b', 'c'] }),
			'public/locales/en/home.json': JSON.stringify({}),
		});

		const { findings } = await run(root);
		const missing = findings.find((f) => f.code === 'KEYS_MISSING');

		expect(missing!.details).toEqual(['bullets']);
	});

	it('still reports a list element missing from a shorter list', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': JSON.stringify({ bullets: ['a', 'b'] }),
			'public/locales/en/home.json': JSON.stringify({ bullets: ['a'] }),
		});

		const { findings } = await run(root);
		const missing = findings.find((f) => f.code === 'KEYS_MISSING');

		expect(missing!.details).toEqual(['bullets.1']);
	});

	it('does not call a file that failed to parse a missing namespace', async () => {
		// INVALID_JSON already says what is wrong with it; NAMESPACE_MISSING
		// would point the developer at a file that is right there on disk.
		const root = await project(BASE, {
			'public/locales/fa/home.json': HOME_FA,
			'public/locales/en/home.json': '{ "hero": ',
		});

		const { findings } = await run(root);
		expect(codes(findings)).toContain('INVALID_JSON');
		expect(codes(findings)).not.toContain('NAMESPACE_MISSING');
	});

	it('reports a key whose shape differs between locales', async () => {
		// A name-only comparison would pass this, and `t.array` would then fail
		// at runtime for English readers only.
		const root = await project(BASE, {
			'public/locales/fa/home.json': JSON.stringify({ hero: { bullets: ['a', 'b'] } }),
			'public/locales/en/home.json': JSON.stringify({ hero: { bullets: 'not a list' } }),
		});

		const { findings } = await run(root);
		const mismatch = findings.find((f) => f.code === 'KEY_SHAPE_MISMATCH');

		expect(mismatch).toBeDefined();
		expect(mismatch!.details?.[0]).toMatch(/hero\.bullets is list in fa, text here/);
	});

	it('warns about keys only a non-default locale defines', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': JSON.stringify({ a: '1' }),
			'public/locales/en/home.json': JSON.stringify({ a: '1', b: '2' }),
		});

		const { findings } = await run(root);
		const extra = findings.find((f) => f.code === 'KEYS_EXTRA');

		expect(extra?.severity).toBe('warning');
		expect(extra?.details).toContain('b');
	});

	it('reports a namespace missing from a non-default locale', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': HOME_FA,
			'public/locales/fa/about.json': JSON.stringify({ title: 'x' }),
			'public/locales/en/home.json': HOME_EN,
		});

		const { findings } = await run(root);
		const missing = findings.find((f) => f.code === 'NAMESPACE_MISSING');

		expect(missing?.severity).toBe('error');
		expect(missing?.message).toMatch(/about/);
	});

	it('reports an invalid config', async () => {
		const root = await project(
			{ locales: ['fa'], defaultLocale: 'de' },
			{ 'public/locales/fa/home.json': HOME_FA },
		);

		const { findings } = await run(root);
		const invalid = findings.find((f) => f.code === 'INVALID_CONFIG');

		expect(invalid?.message).toMatch(/defaultLocale/);
	});

	it('warns about an empty namespace', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': '{}',
			'public/locales/en/home.json': '{}',
		});

		const { findings } = await run(root);
		expect(codes(findings)).toContain('NAMESPACE_EMPTY');
	});
});

describe('artefacts', () => {
	it('writes a manifest keyed by locale and namespace', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home/hero.json': HOME_FA,
			'public/locales/en/home/hero.json': HOME_EN,
		});

		const { config, parsed } = await run(root);
		const manifest = buildManifest(
			parsed.map((p) => ({
				locale: p.file.locale,
				namespace: p.file.namespace,
				hash: p.file.hash,
				entries: p.entries,
			})),
		);

		expect(Object.keys(manifest).sort()).toEqual(['en', 'fa']);
		expect(manifest.fa!['home/hero']).toMatch(/^[0-9a-f]{8}$/);
		expect(config.defaultLocale).toBe('fa');
	});

	it('generates a key registry from the default locale', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': HOME_FA,
			'public/locales/en/home.json': HOME_EN,
		});

		const { config, parsed } = await run(root);
		const types = buildTypes(
			config,
			parsed.map((p) => ({
				locale: p.file.locale,
				namespace: p.file.namespace,
				hash: p.file.hash,
				entries: p.entries,
			})),
			new Map(
				parsed
					.filter((p) => p.file.locale === config.defaultLocale)
					.map((p) => [p.file.namespace, p.scopes]),
			),
		);

		expect(types).toContain("declare module 'i18n-fs'");
		// Root scope reaches everything by its full dotted path...
		expect(types).toMatch(/'': \{ text: [^;]*'hero\.title'/);
		// ...and a scope reaches its own keys by their short name.
		expect(types).toMatch(/'hero': \{ text: [^;]*'title'/);
		// Lists are separated from text so `t.array` can be typed.
		expect(types).toMatch(/list: 'bullets'/);
		// A scope with no lists says `never`, which makes the lookup a type error.
		expect(types).toMatch(/'hero\.cta': \{ text: 'label'; list: never \}/);
	});

	it('generates types only from the default locale', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': JSON.stringify({ a: '1' }),
			'public/locales/en/home.json': JSON.stringify({ a: '1', onlyInEnglish: '2' }),
		});

		const { config, parsed } = await run(root);
		const types = buildTypes(
			config,
			parsed.map((p) => ({
				locale: p.file.locale,
				namespace: p.file.namespace,
				hash: p.file.hash,
				entries: p.entries,
			})),
			new Map([['home', ['']]]),
		);

		expect(types).not.toContain('onlyInEnglish');
	});

	it('emits the resolved config as an importable module', async () => {
		const root = await project(BASE, {});
		const { config } = await run(root);
		const module = buildConfigModule(config);

		expect(module).toContain('export default');
		expect(module).toContain('"defaultLocale": "fa"');
	});

	it('writes all three artefacts, byte-identically on a repeat run', async () => {
		const root = await project(BASE, {
			'public/locales/fa/home.json': HOME_FA,
			'public/locales/en/home.json': HOME_EN,
		});

		const { config, parsed } = await run(root);
		const namespaces = parsed.map((p) => ({
			locale: p.file.locale,
			namespace: p.file.namespace,
			hash: p.file.hash,
			entries: p.entries,
		}));
		const scopes = new Map(
			parsed
				.filter((p) => p.file.locale === config.defaultLocale)
				.map((p) => [p.file.namespace, p.scopes]),
		);

		const dir = outputDir(root);
		await writeArtefacts(dir, config, namespaces, scopes);
		const first = await Promise.all(
			['config.mjs', 'manifest.json', 'messages.d.ts'].map((name) =>
				readFile(join(dir, name), 'utf8'),
			),
		);

		await writeArtefacts(dir, config, namespaces, scopes);
		const second = await Promise.all(
			['config.mjs', 'manifest.json', 'messages.d.ts'].map((name) =>
				readFile(join(dir, name), 'utf8'),
			),
		);

		expect(second).toEqual(first);
	});
});

describe('compareLocales', () => {
	/**
	 * A project whose German tree is written for a German audience rather than
	 * translated from the English one: it drops two keys and adds two of its
	 * own, on purpose.
	 */
	const DIVERGENT = {
		'public/locales/en/home/hero.json': JSON.stringify({
			title: 'Welcome',
			subtitle: 'An English pitch',
			bullets: ['Fast', 'Small'],
		}),
		'public/locales/de/home/hero.json': JSON.stringify({
			title: 'Willkommen',
			angebot: 'Ein deutsches Angebot',
			kontakt: 'Rufen Sie uns an',
		}),
	};

	const CONFIG: I18nFsConfig = { locales: ['en', 'de'], defaultLocale: 'en' };

	it('defaults to on, so a divergent locale is still an error', async () => {
		const { config, findings } = await run(await project(CONFIG, DIVERGENT));

		expect(config.compareLocales).toBe(true);
		expect(codes(findings)).toContain('KEYS_MISSING');
		expect(codes(findings)).toContain('KEYS_EXTRA');
	});

	it('says nothing about the differences when it is off', async () => {
		const root = await project({ ...CONFIG, compareLocales: false }, DIVERGENT);
		const { config, findings } = await run(root);

		expect(config.compareLocales).toBe(false);
		// Silent, not downgraded to a warning: the project has said these
		// locales are not translations of one another, so there is nothing to
		// report rather than something to mention.
		expect(findings).toEqual([]);
	});

	it('still reports what is wrong with a single file', async () => {
		// Only the comparison between locales is switched off. A file that does
		// not parse is a statement about that file, and is not a comparison.
		const root = await project({ ...CONFIG, compareLocales: false }, {
			...DIVERGENT,
			'public/locales/de/broken.json': '{ not json',
			'public/locales/en/empty.json': '{}',
		});
		const { findings } = await run(root);

		expect(codes(findings)).toContain('INVALID_JSON');
		expect(codes(findings)).toContain('NAMESPACE_EMPTY');
		expect(codes(findings)).not.toContain('KEYS_MISSING');
	});

	it('does not hide a locale directory that was never configured', async () => {
		const root = await project({ ...CONFIG, compareLocales: false }, {
			...DIVERGENT,
			'public/locales/it/home/hero.json': JSON.stringify({ title: 'Benvenuto' }),
		});
		const { findings } = await run(root);

		expect(codes(findings)).toContain('LOCALE_DIRECTORY_UNKNOWN');
	});

	it('runs the comparison anyway when asked explicitly', async () => {
		// `check --compare-locales`, which answers the question once without
		// editing the configuration to do it.
		const root = await project({ ...CONFIG, compareLocales: false }, DIVERGENT);
		const configPath = findConfig(root)!;
		const config = resolveConfig(await loadConfig(configPath));
		const scanned = await scan(root, config);

		const { findings } = check(core, config, scanned, true);

		expect(codes(findings)).toContain('KEYS_MISSING');
	});
});

describe('the typed registry follows compareLocales', () => {
	const CONFIG: I18nFsConfig = { locales: ['en', 'de'], defaultLocale: 'en' };

	const FILES = {
		'public/locales/en/home.json': JSON.stringify({ title: 'Welcome', tags: ['a'] }),
		'public/locales/de/home.json': JSON.stringify({ title: 'Willkommen', angebot: 'x' }),
	};

	async function registry(config: I18nFsConfig) {
		const root = await project(config, FILES);
		const { config: resolved, scanned, parsed } = await run(root);

		const namespaces = parsed.map((item) => ({
			locale: item.file.locale,
			namespace: item.file.namespace,
			hash: item.file.hash,
			entries: item.entries,
		}));

		const scopes = new Map<string, string[]>();
		for (const item of parsed) {
			if (resolved.compareLocales && item.file.locale !== resolved.defaultLocale) continue;
			const existing = scopes.get(item.file.namespace);
			scopes.set(
				item.file.namespace,
				existing ? [...new Set([...existing, ...item.scopes])].sort() : item.scopes,
			);
		}

		void scanned;
		return buildTypes(resolved, namespaces, scopes);
	}

	it('types only the default locale when the locales are compared', async () => {
		const types = await registry(CONFIG);

		expect(types).toContain("'title'");
		// `check` guarantees every locale has these, so typing anything else
		// would type a key that is missing where it is used.
		expect(types).not.toContain('angebot');
		expect(types).toContain('Generated from the default locale');
	});

	it('types every locale when they are not', async () => {
		// Without the guarantee, the default locale is no longer the whole
		// truth. A German-only key that did not compile would make the option
		// useless to exactly the projects it exists for.
		const types = await registry({ ...CONFIG, compareLocales: false });

		expect(types).toContain("'title'");
		expect(types).toContain('angebot');
		expect(types).toContain('Generated from every locale, merged');
	});

	it('keeps a list a list when merging', async () => {
		// `tags` exists only in English and is a list. Merging must not flatten
		// it into a text key, or `t.array` would stop type-checking.
		const types = await registry({ ...CONFIG, compareLocales: false });

		expect(types).toMatch(/list: 'tags'/);
	});
});

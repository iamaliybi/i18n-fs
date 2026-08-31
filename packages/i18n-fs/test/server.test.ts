/**
 * The server layer.
 *
 * Locale resolution is tested through its pure function, so the ordering rules
 * are pinned without standing up a Next.js request. Message loading is tested
 * against real files, because reading them is the whole job.
 */

import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedI18nFsConfig } from '../src/config.js';
import { loadFullCore, loadRouter } from '../src/core/index.js';
import { ErrorCode } from '../src/errors.js';
import {
	clearMessageCache,
	isSafeNamespace,
	loadNamespace,
	loadNamespaces,
	namespacePath,
	readRawNamespaces,
} from '../src/server/messages.js';
import { resolveLocaleFromRequest } from '../src/server/locale.js';
import { configureI18n, getI18nConfig, resetI18nConfig } from '../src/server/config.js';

const core = await loadFullCore();
const created: string[] = [];

const CONFIG: ResolvedI18nFsConfig = {
	locales: ['fa', 'en', 'de-AT'],
	defaultLocale: 'fa',
	strategy: 'path',
	prefix: 'as-needed',
	domains: [],
	cookie: { name: 'I18N_FS_LOCALE', maxAge: 1, sameSite: 'lax', path: '/', secure: true },
	messagesDir: 'locales',
	compareLocales: true,
	debug: false,
};

afterEach(async () => {
	clearMessageCache();
	resetI18nConfig();
	await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'i18n-fs-server-'));
	created.push(root);

	for (const [path, contents] of Object.entries(files)) {
		const full = join(root, path);
		await mkdir(join(full, '..'), { recursive: true });
		await writeFile(full, contents, 'utf8');
	}

	return root;
}

const router = await loadRouter(CONFIG);
const negotiate = (header: string) => router.negotiateLocale(header);

describe('locale resolution', () => {
	it('prefers an explicit override over everything else', () => {
		expect(
			resolveLocaleFromRequest(
				CONFIG,
				{ override: 'de-AT', header: 'en', cookie: 'en', acceptLanguage: 'en' },
				negotiate,
			),
		).toEqual({ locale: 'de-AT', source: 'override' });
	});

	it('prefers the middleware header over the cookie', () => {
		// The middleware already applied the routing strategy; the cookie is a
		// previous choice that the URL may have overridden.
		expect(
			resolveLocaleFromRequest(CONFIG, { header: 'en', cookie: 'de-AT' }, negotiate),
		).toEqual({ locale: 'en', source: 'header' });
	});

	it('uses the cookie when no middleware ran', () => {
		expect(resolveLocaleFromRequest(CONFIG, { cookie: 'en' }, negotiate)).toEqual({
			locale: 'en',
			source: 'cookie',
		});
	});

	it('negotiates from Accept-Language when nothing else is set', () => {
		expect(
			resolveLocaleFromRequest(CONFIG, { acceptLanguage: 'en-GB,en;q=0.9' }, negotiate),
		).toEqual({ locale: 'en', source: 'accept-language' });
	});

	it('falls back to the configured default', () => {
		expect(resolveLocaleFromRequest(CONFIG, {}, negotiate)).toEqual({
			locale: 'fa',
			source: 'default',
		});
		expect(resolveLocaleFromRequest(CONFIG, { acceptLanguage: 'ja' }, negotiate)).toEqual({
			locale: 'fa',
			source: 'default',
		});
	});

	it('ignores values that are not configured locales', () => {
		// All of these arrive from the client, and a locale becomes part of a
		// file path. An unrecognised one is discarded, not trusted.
		expect(
			resolveLocaleFromRequest(
				CONFIG,
				{ header: '../../etc', cookie: 'ru', override: 'nope' },
				negotiate,
			),
		).toEqual({ locale: 'fa', source: 'default' });
	});

	it('returns the configured spelling, not the client s', () => {
		expect(resolveLocaleFromRequest(CONFIG, { cookie: 'DE-at' }, negotiate)).toEqual({
			locale: 'de-AT',
			source: 'cookie',
		});
	});
});

describe('namespace safety', () => {
	it('accepts ordinary relative namespaces', () => {
		for (const namespace of ['home', 'home/hero', 'a/b/c']) {
			expect(isSafeNamespace(namespace)).toBe(true);
		}
	});

	it('rejects anything that could escape the messages directory', () => {
		for (const namespace of ['../secrets', 'a/../../b', '/etc/passwd', 'C:/Windows', '', '..']) {
			expect(isSafeNamespace(namespace)).toBe(false);
		}
	});

	it('refuses to load an unsafe namespace', async () => {
		const root = await project({});
		const state = await loadNamespace(CONFIG, 'fa', '../../../secrets', root);

		expect(state.status).toBe('failed');
		if (state.status === 'failed') {
			expect(state.error.code).toBe(ErrorCode.NamespaceNotFound);
		}
	});
});

describe('loading namespaces', () => {
	it('reads a namespace from public/', async () => {
		const root = await project({
			'public/locales/fa/home/hero.json': JSON.stringify({ title: 'خوش آمدید' }),
		});

		const state = await loadNamespace(CONFIG, 'fa', 'home/hero', root);
		expect(state.status).toBe('ready');
		if (state.status === 'ready') {
			expect(state.store.resolveText(undefined, 'title')).toBe('خوش آمدید');
		}
	});

	it('builds the path from the configured messages directory', async () => {
		expect(namespacePath('/app', { ...CONFIG, messagesDir: 'i18n' }, 'fa', 'home')).toBe(
			join('/app', 'public', 'i18n', 'fa', 'home.json'),
		);
	});

	it('captures a missing file rather than throwing', async () => {
		// A missing namespace must not blank the page; it degrades per key.
		const root = await project({});
		const state = await loadNamespace(CONFIG, 'fa', 'home', root);

		expect(state.status).toBe('failed');
		if (state.status === 'failed') {
			expect(state.error.code).toBe(ErrorCode.NamespaceNotFound);
			expect(state.error.detail).toBeTruthy();
		}
	});

	it('captures invalid JSON with the parser detail', async () => {
		const root = await project({ 'public/locales/fa/home.json': '{ "a": ' });
		const state = await loadNamespace(CONFIG, 'fa', 'home', root);

		expect(state.status).toBe('failed');
		if (state.status === 'failed') {
			expect(state.error.code).toBe(ErrorCode.InvalidJson);
			expect(state.error.detail).toMatch(/line \d+ column \d+/);
		}
	});

	it('caches a namespace so it is parsed once', async () => {
		const root = await project({ 'public/locales/fa/home.json': JSON.stringify({ a: '1' }) });

		const first = await loadNamespace(CONFIG, 'fa', 'home', root);
		// Change the file underneath; the cached store must win.
		await writeFile(join(root, 'public/locales/fa/home.json'), JSON.stringify({ a: '2' }), 'utf8');
		const second = await loadNamespace(CONFIG, 'fa', 'home', root);

		expect(second).toBe(first);
	});

	it('re-reads a namespace whose file changed, in development', async () => {
		// Message files live under `public/`, so editing one reloads no module and
		// Next.js has nothing to re-run. Without this the developer edits a
		// translation, sees the old text, and blames the package.
		const root = await project({ 'public/locales/fa/home.json': JSON.stringify({ a: '1' }) });
		const debug = { ...CONFIG, debug: true };
		const file = join(root, 'public/locales/fa/home.json');

		const first = await loadNamespace(debug, 'fa', 'home', root);
		expect(first.status).toBe('ready');
		if (first.status === 'ready') expect(first.store.resolveText(undefined, 'a')).toBe('1');

		await writeFile(file, JSON.stringify({ a: '2' }), 'utf8');

		// Timestamps have millisecond resolution, and two writes inside one
		// millisecond are indistinguishable — so the change is made explicit
		// rather than left to how fast the machine happens to be.
		const later = new Date(Date.now() + 2000);
		await utimes(file, later, later);

		const second = await loadNamespace(debug, 'fa', 'home', root);
		expect(second.status).toBe('ready');
		if (second.status === 'ready') expect(second.store.resolveText(undefined, 'a')).toBe('2');
	});

	it('keeps the cached namespace in production even when the file changes', async () => {
		// The mirror of the test above: outside development nothing is stat-ed,
		// because the files cannot change under a running build and a stat per
		// render per namespace would be pure loss.
		const root = await project({ 'public/locales/fa/home.json': JSON.stringify({ a: '1' }) });
		const file = join(root, 'public/locales/fa/home.json');

		const first = await loadNamespace(CONFIG, 'fa', 'home', root);

		await writeFile(file, JSON.stringify({ a: '2' }), 'utf8');
		const later = new Date(Date.now() + 2000);
		await utimes(file, later, later);

		expect(await loadNamespace(CONFIG, 'fa', 'home', root)).toBe(first);
	});

	it('says what clears a failure, differently per environment', async () => {
		const root = await project({});

		const production = await loadNamespace(CONFIG, 'fa', 'home', root);
		expect(production.status).toBe('failed');
		if (production.status === 'failed') {
			expect(production.error.detail).toContain('the server keeps this result until it restarts');
		}

		clearMessageCache();

		const development = await loadNamespace({ ...CONFIG, debug: true }, 'fa', 'home', root);
		expect(development.status).toBe('failed');
		if (development.status === 'failed') {
			expect(development.error.detail).toContain('the file is re-read when it changes');
		}
	});

	it('does not cache failures in debug mode', async () => {
		// Otherwise fixing the file would need a server restart.
		const root = await project({});
		const debug = { ...CONFIG, debug: true };

		const first = await loadNamespace(debug, 'fa', 'home', root);
		expect(first.status).toBe('failed');

		await mkdir(join(root, 'public/locales/fa'), { recursive: true });
		await writeFile(join(root, 'public/locales/fa/home.json'), JSON.stringify({ a: '1' }), 'utf8');

		const second = await loadNamespace(debug, 'fa', 'home', root);
		expect(second.status).toBe('ready');
	});

	it('loads several namespaces at once, de-duplicating', async () => {
		const root = await project({
			'public/locales/fa/a.json': JSON.stringify({ x: '1' }),
			'public/locales/fa/b.json': JSON.stringify({ y: '2' }),
		});

		const bundle = await loadNamespaces(CONFIG, 'fa', ['a', 'b', 'a'], root);
		expect([...bundle.keys()].sort()).toEqual(['a', 'b']);
	});
});

describe('serialising for the client', () => {
	it('returns parsed JSON per namespace', async () => {
		const root = await project({
			'public/locales/fa/home.json': JSON.stringify({ title: 'x' }),
			'public/locales/fa/footer.json': JSON.stringify({ copy: 'y' }),
		});

		expect(await readRawNamespaces(CONFIG, 'fa', ['home', 'footer'], root)).toEqual({
			home: { title: 'x' },
			footer: { copy: 'y' },
		});
	});

	it('omits a namespace it cannot read, rather than failing the render', async () => {
		const root = await project({ 'public/locales/fa/home.json': JSON.stringify({ title: 'x' }) });

		expect(await readRawNamespaces(CONFIG, 'fa', ['home', 'missing'], root)).toEqual({
			home: { title: 'x' },
		});
	});

	it('never reads outside the messages directory', async () => {
		const root = await project({ 'secret.json': JSON.stringify({ token: 'nope' }) });

		expect(await readRawNamespaces(CONFIG, 'fa', ['../../secret'], root)).toEqual({});
	});
});

describe('configuration', () => {
	it('returns whatever was registered', async () => {
		configureI18n(CONFIG);
		expect(await getI18nConfig()).toEqual(CONFIG);
	});

	it('explains what to do when nothing is registered and nothing is generated', async () => {
		resetI18nConfig();
		const cwd = process.cwd();
		const empty = await mkdtemp(join(tmpdir(), 'i18n-fs-empty-'));
		created.push(empty);

		process.chdir(empty);
		try {
			await expect(getI18nConfig()).rejects.toThrow(/i18n-fs build|configureI18n/);
		} finally {
			process.chdir(cwd);
		}
	});
});

/**
 * `I18nProvider` — the server-to-client handoff.
 *
 * The provider is an async Server Component, so it is invoked directly and its
 * returned tree rendered. That exercises the real thing without standing up a
 * Next.js server.
 */

// @vitest-environment jsdom

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Suspense } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedI18nFsConfig } from '../src/config.js';
import { I18nClientProvider, useI18nContext, useLocale } from '../src/client/context.js';
import { clearNamespaceCache } from '../src/client/namespaces.js';
import { useTranslation } from '../src/client/useTranslation.js';
import { I18nProvider } from '../src/server/provider.js';
import { configureI18n, resetI18nConfig } from '../src/server/config.js';

const CONFIG: ResolvedI18nFsConfig = {
	locales: ['fa', 'en'],
	defaultLocale: 'fa',
	strategy: 'path',
	prefix: 'as-needed',
	domains: [],
	cookie: { name: 'I18N_FS_LOCALE', maxAge: 1, sameSite: 'lax', path: '/', secure: true },
	messagesDir: 'locales',
	debug: false,
};

let root: string;
let previousCwd: string;

beforeEach(async () => {
	previousCwd = process.cwd();
	root = await mkdtemp(join(tmpdir(), 'i18n-fs-provider-'));

	await mkdir(join(root, 'public/locales/fa'), { recursive: true });
	await writeFile(
		join(root, 'public/locales/fa/home.json'),
		JSON.stringify({ title: 'خوش آمدید' }),
		'utf8',
	);

	// The provider reads relative to the working directory, as it does in a
	// real app.
	process.chdir(root);
	configureI18n(CONFIG);
});

afterEach(async () => {
	// vitest does not enable testing-library's automatic cleanup unless globals
	// are on, and without it each render stacks up in the same document.
	cleanup();
	process.chdir(previousCwd);
	resetI18nConfig();
	await rm(root, { recursive: true, force: true });
});

function Probe() {
	const { locale, messages, config } = useI18nContext();

	return (
		<>
			<span data-testid="locale">{locale}</span>
			<span data-testid="namespaces">{Object.keys(messages).join(',')}</span>
			<span data-testid="default">{config.defaultLocale}</span>
		</>
	);
}

describe('I18nProvider prefetch', () => {
	// The middle setting between inlining a namespace and not sending it at all:
	// the browser starts fetching in parallel with the JavaScript, and the HTML
	// does not grow.
	const links = () => [...document.querySelectorAll('link[rel="preload"]')];

	it('emits a preload link per prefetched namespace', async () => {
		render(await I18nProvider({ locale: 'fa', prefetch: ['home'], children: <Probe /> }));

		expect(links()).toHaveLength(1);
		expect(links()[0]?.getAttribute('href')).toBe('/locales/fa/home.json');
		expect(links()[0]?.getAttribute('as')).toBe('fetch');
	});

	it('does not preload what it already sent', async () => {
		// The payload already has it, so the fetch would never happen and the
		// browser would report the preload as unused — correctly.
		render(
			await I18nProvider({
				locale: 'fa',
				namespaces: ['home'],
				prefetch: ['home'],
				children: <Probe />,
			}),
		);

		expect(screen.getByTestId('namespaces').textContent).toBe('home');
		expect(links()).toHaveLength(0);
	});

	it('emits nothing when nothing is prefetched', async () => {
		render(await I18nProvider({ locale: 'fa', children: <Probe /> }));
		expect(links()).toHaveLength(0);
	});

	it('does not repeat a namespace named twice', async () => {
		render(await I18nProvider({ locale: 'fa', prefetch: ['home', 'home'], children: <Probe /> }));
		expect(links()).toHaveLength(1);
	});

	it('carries crossOrigin, without which the browser refuses to reuse it', async () => {
		// Required even same-origin: a preload without it has different
		// credentials than the `fetch()` the client makes, so the browser
		// downloads the file twice and reports the preload as unused. Confirmed
		// in Chrome, which says "the request credentials mode does not match".
		render(await I18nProvider({ locale: 'fa', prefetch: ['home'], children: <Probe /> }));
		expect(links()[0]?.getAttribute('crossorigin')).toBe('anonymous');
	});

	it('asks for it at low priority, so it does not compete with the page', async () => {
		render(await I18nProvider({ locale: 'fa', prefetch: ['home'], children: <Probe /> }));
		expect(links()[0]?.getAttribute('fetchpriority')).toBe('low');
	});
});

describe('I18nProvider', () => {
	it('provides the locale and config to the client tree', async () => {
		render(await I18nProvider({ locale: 'fa', children: <Probe /> }));

		expect(screen.getByTestId('locale').textContent).toBe('fa');
		expect(screen.getByTestId('default').textContent).toBe('fa');
	});

	it('sends only the namespaces it was asked for', async () => {
		render(
			await I18nProvider({ locale: 'fa', namespaces: ['home'], children: <Probe /> }),
		);

		expect(screen.getByTestId('namespaces').textContent).toBe('home');
	});

	it('sends nothing when no namespaces are named', async () => {
		// Shipping the whole tree by default would put every page's strings into
		// every page's payload.
		render(await I18nProvider({ locale: 'fa', children: <Probe /> }));

		expect(screen.getByTestId('namespaces').textContent).toBe('');
	});

	it('renders even when a requested namespace is missing', async () => {
		render(
			await I18nProvider({
				locale: 'fa',
				namespaces: ['home', 'nope'],
				children: <Probe /> ,
			}),
		);

		expect(screen.getByTestId('namespaces').textContent).toBe('home');
		expect(screen.getByTestId('locale').textContent).toBe('fa');
	});

	it('tells the developer what to do when there is no provider', () => {
		function Bare() {
			useLocale();
			return null;
		}

		const original = console.error;
		console.error = () => {};
		try {
			expect(() => render(<Bare />)).toThrow(/Render <I18nProvider>/);
		} finally {
			console.error = original;
		}
	});
});

describe('nesting one provider inside another', () => {
	// Documented in docs/guide/translating.md#where-to-put-the-provider. The
	// behaviour is surprising enough to pin: the inner provider replaces the
	// context rather than extending it, so a subtree that reads a namespace the
	// inner one did not list falls through to the network — fetching the same
	// file the server already inlined into the HTML.
	function Reads({ namespace, id }: { namespace: string; id: string }) {
		const t = useTranslation(namespace);
		return <span data-testid={id}>{t('title')}</span>;
	}

	it('does not inherit the outer namespaces', async () => {
		const fetches: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				fetches.push(String(url));
				return new Response('{"title":"from the network"}', { status: 200 });
			}),
		);
		clearNamespaceCache();

		await act(async () => {
			render(
				<I18nClientProvider
					locale="fa"
					config={CONFIG}
					messages={{ common: { title: 'sent by the outer provider' } }}
					manifest={{}}
				>
					<Suspense fallback={<span>…</span>}>
						<I18nClientProvider
							locale="fa"
							config={CONFIG}
							messages={{ page: { title: 'sent by the inner provider' } }}
							manifest={{}}
						>
							<Reads namespace="common" id="inner" />
						</I18nClientProvider>
					</Suspense>
				</I18nClientProvider>,
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});

		expect(screen.getByTestId('inner').textContent).toBe('from the network');
		expect(fetches).toEqual(['/locales/fa/common.json']);

		vi.unstubAllGlobals();
	});

	it('costs nothing when something above already read the namespace', async () => {
		// The saving grace, and the reason this is a size question rather than a
		// correctness one: the namespace cache is module-scoped and keyed by
		// locale and name, so the second reader finds it however the first got it.
		const fetches: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				fetches.push(String(url));
				return new Response('{"title":"from the network"}', { status: 200 });
			}),
		);
		clearNamespaceCache();

		await act(async () => {
			render(
				<I18nClientProvider
					locale="fa"
					config={CONFIG}
					messages={{ common: { title: 'sent by the outer provider' } }}
					manifest={{}}
				>
					<Suspense fallback={<span>…</span>}>
						<Reads namespace="common" id="outer" />
						<I18nClientProvider locale="fa" config={CONFIG} messages={{}} manifest={{}}>
							<Reads namespace="common" id="inner" />
						</I18nClientProvider>
					</Suspense>
				</I18nClientProvider>,
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});

		expect(screen.getByTestId('inner').textContent).toBe('sent by the outer provider');
		expect(fetches).toEqual([]);

		vi.unstubAllGlobals();
	});
});

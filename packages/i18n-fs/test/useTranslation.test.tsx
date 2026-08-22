/**
 * `useTranslation` in Client Components.
 *
 * The interesting behaviour is suspension. The prototype threw a promise from
 * inside the hook and tracked its progress in a local variable that the very
 * re-render the promise triggered then reset — so it never settled. These tests
 * pin down that a namespace resolves, resolves *once*, and that a component
 * still renders when the file behind it is missing or broken.
 */

// @vitest-environment jsdom

import { Suspense, type ReactNode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedI18nFsConfig } from '../src/config.js';
import { I18nClientProvider } from '../src/client/context.js';
import { clearNamespaceCache, namespaceUrl } from '../src/client/namespaces.js';
import { resetClientReporter, useTranslation } from '../src/client/useTranslation.js';
import type { Translator } from '../src/translator.js';

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

const HERO = {
	title: 'Welcome',
	greeting: 'Hello {name}',
	bullets: ['Fast', 'Small'],
	cta: { label: 'Start' },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	clearNamespaceCache();
	resetClientReporter();

	fetchMock = vi.fn(async (url: string) => {
		if (url.startsWith('/locales/fa/home/hero.json')) {
			return new Response(JSON.stringify(HERO), { status: 200 });
		}
		if (url.startsWith('/locales/fa/broken.json')) {
			return new Response('{ "a": ', { status: 200 });
		}
		return new Response('Not Found', { status: 404 });
	});

	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

interface HarnessOptions {
	messages?: Record<string, unknown>;
	manifest?: Record<string, string>;
	namespace?: string;
	scope?: string;
}

type HarnessProps = HarnessOptions & { render: (t: Translator) => ReactNode };

function Harness({
	messages = {},
	manifest = {},
	namespace = 'home/hero',
	scope,
	render: renderProp,
}: HarnessProps) {
	function Consumer() {
		const t = useTranslation(namespace, scope);
		return <div data-testid="out">{renderProp(t)}</div>;
	}

	return (
		<I18nClientProvider locale="fa" config={CONFIG} messages={messages} manifest={manifest}>
			<Suspense fallback={<span data-testid="loading">loading</span>}>
				<Consumer />
			</Suspense>
		</I18nClientProvider>
	);
}

async function show(options: HarnessProps) {
	await act(async () => {
		render(<Harness {...options} />);
	});
	await waitFor(() => expect(screen.queryByTestId('out')).not.toBeNull());
	return screen.getByTestId('out');
}

describe('namespaces the server already sent', () => {
	it('resolves without fetching', async () => {
		const out = await show({
			messages: { 'home/hero': HERO },
			render: (t) => t('title'),
		});

		expect(out.textContent).toBe('Welcome');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('resolves inside a scope', async () => {
		const out = await show({
			messages: { 'home/hero': HERO },
			scope: 'cta',
			render: (t) => t('label'),
		});

		expect(out.textContent).toBe('Start');
	});
});

describe('namespaces the client has to fetch', () => {
	it('suspends until the namespace arrives, then renders', async () => {
		// The fetch is held open so the fallback can be observed deterministically
		// rather than by racing microtasks.
		let release!: (response: Response) => void;
		fetchMock.mockImplementationOnce(
			() => new Promise<Response>((resolve) => (release = resolve)),
		);

		await act(async () => {
			render(<Harness render={(t) => t('title')} />);
		});

		expect(screen.getByTestId('loading')).toBeTruthy();
		expect(screen.queryByTestId('out')).toBeNull();

		await act(async () => {
			release(new Response(JSON.stringify(HERO), { status: 200 }));
		});

		await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('Welcome'));
		expect(screen.queryByTestId('loading')).toBeNull();
	});

	it('appends the content hash so the response can be cached immutably', async () => {
		await show({
			manifest: { 'home/hero': 'abc12345' },
			render: (t) => t('title'),
		});

		expect(fetchMock).toHaveBeenCalledWith('/locales/fa/home/hero.json?v=abc12345');
	});

	it('fetches without a hash when the manifest has none', async () => {
		await show({ render: (t) => t('title') });
		expect(fetchMock).toHaveBeenCalledWith('/locales/fa/home/hero.json');
	});

	it('fetches a namespace once however many components ask for it', async () => {
		// The cache lives at module scope precisely so this holds. A promise
		// created during render would be a new one each attempt.
		function Consumer({ id }: { id: string }) {
			const t = useTranslation('home/hero');
			return <span data-testid={id}>{t('title')}</span>;
		}

		await act(async () => {
			render(
				<I18nClientProvider locale="fa" config={CONFIG} messages={{}} manifest={{}}>
					<Suspense fallback="loading">
						<Consumer id="a" />
						<Consumer id="b" />
						<Consumer id="c" />
					</Suspense>
				</I18nClientProvider>,
			);
		});

		await waitFor(() => expect(screen.getByTestId('c').textContent).toBe('Welcome'));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe('failures do not take the page down', () => {
	it('renders fallbacks when the file is missing', async () => {
		const out = await show({
			namespace: 'nope',
			render: (t) => t('title', {}, { fallback: 'Untranslated' }),
		});

		expect(out.textContent).toBe('Untranslated');
	});

	it('renders the key when there is no fallback', async () => {
		const out = await show({ namespace: 'nope', render: (t) => t('title') });
		expect(out.textContent).toBe('title');
	});

	it('renders fallbacks when the file is malformed', async () => {
		const out = await show({ namespace: 'broken', render: (t) => t('title') });
		expect(out.textContent).toBe('title');
	});

	it('never rejects the suspended promise, so no error boundary is needed', async () => {
		// A missing translation file must not be an unhandled rejection.
		const out = await show({ namespace: 'nope', render: (t) => t('x') });
		expect(out.textContent).toBe('x');
	});
});

describe('the full translator surface', () => {
	it('interpolates, lists, checks and reads raw', async () => {
		const out = await show({
			messages: { 'home/hero': HERO },
			render: (t) =>
				[
					t('greeting', { name: 'Ali' }),
					t.array('bullets').join('+'),
					String(t.has('title')),
					String(t.raw('greeting')),
				].join(' | '),
		});

		expect(out.textContent).toBe('Hello Ali | Fast+Small | true | Hello {name}');
	});

	it('renders rich messages with caller-supplied tags', async () => {
		const out = await show({
			messages: { 'home/hero': { terms: 'Read the <link>terms</link>' } },
			render: (t) => t.rich('terms', { link: (chunk) => <a href="/terms">{chunk}</a> }),
		});

		expect(out.querySelector('a')?.textContent).toBe('terms');
	});
});

describe('urls', () => {
	it('is built from the configured messages directory', () => {
		expect(namespaceUrl({ ...CONFIG, messagesDir: 'i18n' }, 'en', 'a/b', 'ff00')).toBe(
			'/i18n/en/a/b.json?v=ff00',
		);
	});
});

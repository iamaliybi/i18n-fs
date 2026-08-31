/**
 * `usePrefetch` — warming a namespace before something reads it.
 *
 * The behaviour that matters is not "does it fetch". It is what happens when a
 * prefetch fails: a read that fails is cached, so one 404 does not become a
 * request per render, but a prefetch is a guess. Remembering a failed guess
 * would let a transient blip decide that a namespace is missing for the rest of
 * the page's life — the component that actually needs it would render fallbacks
 * having never tried.
 */

// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedI18nFsConfig } from '../src/config.js';
import { I18nClientProvider } from '../src/client/context.js';
import { clearNamespaceCache, hasNamespace } from '../src/client/namespaces.js';
import { usePrefetch } from '../src/client/prefetch.js';
import { useTranslation } from '../src/client/useTranslation.js';

const CONFIG: ResolvedI18nFsConfig = {
	locales: ['fa', 'en'],
	defaultLocale: 'fa',
	strategy: 'path',
	prefix: 'as-needed',
	domains: [],
	cookie: { name: 'I18N_FS_LOCALE', maxAge: 1, sameSite: 'lax', path: '/', secure: true },
	messagesDir: 'locales',
	compareLocales: true,
	debug: false,
};

const PANEL = { title: 'Settings' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	clearNamespaceCache();
	fetchMock = vi.fn(async () => new Response(JSON.stringify(PANEL), { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function Wrapper({
	children,
	messages = {},
	manifest = {},
}: {
	children: ReactNode;
	messages?: Record<string, unknown>;
	manifest?: Record<string, string>;
}) {
	return (
		<I18nClientProvider locale="fa" config={CONFIG} messages={messages} manifest={manifest}>
			{children}
		</I18nClientProvider>
	);
}

/** Renders a button that prefetches on the intent signal, as a real app would. */
function Trigger({ namespace = 'settings/panel' }: { namespace?: string }) {
	const prefetch = usePrefetch();

	return (
		<button type="button" data-testid="trigger" onPointerEnter={() => prefetch(namespace)}>
			open
		</button>
	);
}

function Panel() {
	const t = useTranslation('settings/panel');
	return <span data-testid="panel">{t('title')}</span>;
}

describe('usePrefetch', () => {
	it('fetches the namespace without rendering it', async () => {
		render(
			<Wrapper manifest={{ 'settings/panel': 'abc123' }}>
				<Trigger />
			</Wrapper>,
		);

		expect(fetchMock).not.toHaveBeenCalled();

		await act(async () => {
			fireEvent.pointerEnter(screen.getByTestId('trigger'));
		});

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(fetchMock).toHaveBeenCalledWith('/locales/fa/settings/panel.json?v=abc123');
	});

	it('lets the component render without suspending once it has arrived', async () => {
		render(
			<Wrapper>
				<Trigger />
			</Wrapper>,
		);

		await act(async () => {
			fireEvent.pointerEnter(screen.getByTestId('trigger'));
		});

		await waitFor(() => expect(hasNamespace('fa', 'settings/panel')).toBe(true));

		// The panel opens against a cache that is already warm. One fetch total,
		// not two: the read reuses what the prefetch started.
		// Inside act, so React flushes the already-resolved promise rather than
		// leaving the component parked on its fallback.
		await act(async () => {
			render(
				<Wrapper>
					<Suspense fallback={<span data-testid="waiting">…</span>}>
						<Panel />
					</Suspense>
				</Wrapper>,
			);
		});

		await waitFor(() => expect(screen.getByTestId('panel').textContent).toBe('Settings'));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does not fetch what the server already sent', async () => {
		render(
			<Wrapper messages={{ 'settings/panel': PANEL }}>
				<Trigger />
			</Wrapper>,
		);

		await act(async () => {
			fireEvent.pointerEnter(screen.getByTestId('trigger'));
		});

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not fetch twice for repeated intent', async () => {
		render(
			<Wrapper>
				<Trigger />
			</Wrapper>,
		);

		for (let i = 0; i < 3; i += 1) {
			await act(async () => {
				fireEvent.pointerEnter(screen.getByTestId('trigger'));
			});
		}

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('forgets a failed prefetch, so the read that needs it starts clean', async () => {
		// The whole point. A blip while guessing must not decide the answer for
		// the component that actually asks.
		fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }));

		render(
			<Wrapper>
				<Trigger />
			</Wrapper>,
		);

		await act(async () => {
			fireEvent.pointerEnter(screen.getByTestId('trigger'));
		});

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(hasNamespace('fa', 'settings/panel')).toBe(false));

		// Now the component reads it for real, and gets the message.
		// Inside act, so React flushes the already-resolved promise rather than
		// leaving the component parked on its fallback.
		await act(async () => {
			render(
				<Wrapper>
					<Suspense fallback={<span data-testid="waiting">…</span>}>
						<Panel />
					</Suspense>
				</Wrapper>,
			);
		});

		await waitFor(() => expect(screen.getByTestId('panel').textContent).toBe('Settings'));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('takes several namespaces at once', async () => {
		function Many() {
			const prefetch = usePrefetch();
			return (
				<button
					type="button"
					data-testid="many"
					onPointerEnter={() => prefetch('settings/panel', 'settings/advanced')}
				>
					open
				</button>
			);
		}

		render(
			<Wrapper>
				<Many />
			</Wrapper>,
		);

		await act(async () => {
			fireEvent.pointerEnter(screen.getByTestId('many'));
		});

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
	});
});

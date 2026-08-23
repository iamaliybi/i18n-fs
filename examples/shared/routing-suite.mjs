/**
 * The routing contract, shared by every example app.
 *
 * The point of having more than one example is that they behave identically on
 * different Next.js versions and different file conventions. Duplicating the
 * assertions would let that claim rot quietly: one copy could stop testing
 * something and the suite would still be green. So there is one copy, and each
 * example is a thin file that runs it.
 *
 * The tests run at the HTTP level rather than through a browser, deliberately.
 * The property under test is that a redirect chain terminates and settles on
 * the locale it was asked for, which is a statement about status codes and
 * `Location` headers. A browser would add a large download and a lot of
 * machinery without observing anything more — and it would *hide* the chain
 * behind automatic redirect following, which is the very thing being measured.
 *
 * The core already proves idempotence by property test (ADR 0004). What this
 * adds is that the real Next.js runtime, the real matcher and the real
 * WebAssembly binary agree with it.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';

/**
 * Register the whole suite against one example app.
 *
 * @param {object} options
 * @param {string} options.root  the example's directory
 * @param {number} options.port  a port no other example uses
 * @param {string} options.label what to call it in test names
 */
export function describeRouting({ root, port, label }) {
	const base = `http://127.0.0.1:${port}`;

	/** Follow redirects by hand, carrying cookies as a browser would. */
	async function follow(path, { headers = {}, limit = 10 } = {}) {
		const chain = [];
		// Concatenated, not resolved: `new URL('//en//about', base)` is a
		// protocol-relative URL and would resolve to the host `en`.
		let url = path.startsWith('/') ? base + path : new URL(path, base).toString();
		let cookie = headers.cookie ?? '';

		for (let hop = 0; hop <= limit; hop += 1) {
			const response = await fetch(url, {
				redirect: 'manual',
				headers: { ...headers, ...(cookie ? { cookie } : {}) },
			});

			chain.push({ url, status: response.status, location: response.headers.get('location') });

			for (const entry of response.headers.getSetCookie?.() ?? []) {
				const pair = entry.split(';')[0];
				if (pair) cookie = cookie ? `${cookie}; ${pair}` : pair;
			}

			if (response.status < 300 || response.status >= 400) {
				return { chain, status: response.status, body: await response.text() };
			}

			const location = response.headers.get('location');
			assert.ok(location, `redirect from ${url} had no Location header`);
			url = location.startsWith('/') ? base + location : new URL(location, url).toString();
		}

		assert.fail(
			`redirect chain did not terminate within ${limit} hops:\n${chain
				.map((hop) => `  ${hop.status} ${hop.url} -> ${hop.location ?? ''}`)
				.join('\n')}`,
		);
	}

	let server;

	before(async () => {
		server = spawn(
			process.execPath,
			[join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(port)],
			{ cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
		);

		server.stderr.on('data', (chunk) => process.stderr.write(chunk));

		const deadline = Date.now() + 60_000;
		for (;;) {
			if (Date.now() > deadline) throw new Error(`${label}: next start did not become ready`);

			try {
				await fetch(`${base}/`, { redirect: 'manual' });
				return;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
		}
	});

	after(() => {
		server?.kill();
	});

	describe(`${label}: the default locale is served unprefixed`, () => {
		it('rewrites / to the default locale without changing the URL', async () => {
			const { chain, status, body } = await follow('/');

			assert.equal(status, 200);
			assert.equal(chain.length, 1, 'the root should not redirect');
			assert.match(body, /خوش آمدید/);
		});

		it('redirects the redundant default prefix, permanently', async () => {
			const { chain, status } = await follow('/fa');

			assert.equal(status, 200);
			assert.equal(chain[0].status, 308, 'a URL-derived canonical form is the same for everyone');
			assert.equal(new URL(chain[0].location, base).pathname, '/');
		});
	});

	describe(`${label}: a non-default locale keeps its prefix`, () => {
		it('serves /en directly', async () => {
			const { chain, status, body } = await follow('/en');

			assert.equal(status, 200);
			assert.equal(chain.length, 1);
			assert.match(body, /Welcome/);
		});

		it('serves a nested route', async () => {
			const { status, body } = await follow('/en/about');
			assert.equal(status, 200);
			assert.match(body, /About/);
		});
	});

	describe(`${label}: Accept-Language`, () => {
		it('redirects to the negotiated locale, temporarily', async () => {
			const { chain, status, body } = await follow('/', {
				headers: { 'accept-language': 'en-GB,en;q=0.9' },
			});

			assert.equal(status, 200);
			assert.equal(chain[0].status, 307, 'a per-visitor redirect must never be cached');
			assert.equal(new URL(chain[0].location, base).pathname, '/en');
			assert.match(body, /Welcome/);
		});

		it('serves the default locale when nothing matches', async () => {
			const { status, body } = await follow('/', { headers: { 'accept-language': 'ja' } });

			assert.equal(status, 200);
			assert.match(body, /خوش آمدید/);
		});
	});

	describe(`${label}: everything else is left alone`, () => {
		it('serves message files untouched', async () => {
			const { chain, status, body } = await follow('/locales/fa/common.json');

			assert.equal(status, 200);
			assert.equal(chain.length, 1, 'a static asset must never redirect');
			assert.equal(JSON.parse(body).about, 'درباره');
		});

		it('does not redirect framework paths', async () => {
			const { chain } = await follow('/_next/static/does-not-exist.js');
			assert.equal(chain.length, 1);
		});
	});

	describe(`${label}: redirect chains terminate`, () => {
		// Repeated prefixes, empty segments, a locale name used as a route, and a
		// prefix that contradicts the cookie.
		const paths = [
			'/',
			'/fa',
			'/en',
			'/fa/fa',
			'/en/en/about',
			'/fa/en/about',
			'//en//about',
			'/en/about/',
			'/about',
			'/blog/fa',
		];

		for (const path of paths) {
			it(`${path} settles without looping`, async () => {
				const { chain, status } = await follow(path, { limit: 4 });

				assert.ok(status < 300 || status >= 400, `${path} ended on a redirect`);
				assert.ok(
					chain.length <= 2,
					`${path} took ${chain.length} hops:\n${chain
						.map((hop) => `  ${hop.status} ${hop.url} -> ${hop.location ?? ''}`)
						.join('\n')}`,
				);
			});
		}

		it('keeps the locale the URL asked for', async () => {
			// Terminating is not enough: a chain that settles on a different locale
			// than the request named is still wrong.
			const { status, body } = await follow('/en/about', {
				headers: { cookie: 'I18N_FS_LOCALE=fa' },
			});

			assert.equal(status, 200);
			assert.match(body, /About/, 'the /en prefix must win over a stale cookie');
		});
	});

	describe(`${label}: the resolved locale reaches the server layer`, () => {
		it('is echoed on the response', async () => {
			const response = await fetch(`${base}/en`, { redirect: 'manual' });
			assert.equal(response.headers.get('x-i18n-fs-locale'), 'en');
		});

		it('sets the cookie when the choice is new', async () => {
			const response = await fetch(`${base}/en`, { redirect: 'manual' });
			const cookies = (response.headers.getSetCookie?.() ?? []).join(';');
			assert.match(cookies, /I18N_FS_LOCALE=en/);
		});
	});

	describe(`${label}: a missing key does not break the page`, () => {
		it('renders the developer fallback', async () => {
			const { body } = await follow('/en');
			assert.match(body, /fallback shown/);
		});
	});
}

/**
 * What each WebAssembly binary is allowed to contain.
 *
 * There are three because the three consumers need different halves of the
 * core, and only one of them is downloaded by a visitor. The browser binary
 * carried routing and config validation for a long time without anyone
 * noticing: nothing in the browser calls them — `<Link>` and `usePathname` are
 * answered by a TypeScript mirror of the same rules so they can stay
 * synchronous, and every redirect decision is made by the proxy before the page
 * is served — so 34 KB gzip shipped to every visitor and never ran.
 *
 * Nothing would have failed if it came back. A cargo feature added to `default`,
 * a build script that stops passing `--no-default-features`, a function that
 * loses its `#[cfg]`: each is a one-line change, and the only symptom is a
 * larger download. So the surface is pinned exactly rather than loosely — an
 * unexpected export is as much a failure here as a missing one.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const wasm = fileURLToPath(new URL('../wasm/', import.meta.url));

/** Names the wasm-pack glue exports, which is the binary's public surface. */
function surface(build: string): string[] {
	const glue = `${wasm}${build}/i18n_fs_wasm.js`;

	if (!existsSync(glue)) {
		throw new Error(`${build} glue is missing — run \`npm run bootstrap\` before the tests`);
	}

	return [...readFileSync(glue, 'utf8').matchAll(/^export (?:function|class) (\w+)/gm)]
		.map((match) => match[1] ?? '')
		.sort();
}

/**
 * Routing: the proxy and the server.
 *
 * Two class names rather than five functions. The configuration used to cross
 * as a serialised object on every call, which put `serde-wasm-bindgen` in the
 * Edge binary — a third of it, for a value that never changes while the process
 * lives. A `Router` is built once from primitives and answers questions
 * afterwards; `Decision` is its reply.
 */
const ROUTING = ['Decision', 'Router'];

/** Message storage and formatting: the browser and the server. */
const MESSAGES = ['Store', 'interpolate', 'tokenize'];

describe('the browser binary', () => {
	// The only one a visitor downloads.
	it('carries messages and nothing else', () => {
		expect(surface('browser')).toEqual(['Store', 'coreVersion', 'interpolate', 'tokenize']);
	});

	it.each(ROUTING)('does not carry %s', (name) => {
		expect(surface('browser')).not.toContain(name);
	});

	it('does not carry validateConfig, which drags in the config serde bridge', () => {
		expect(surface('browser')).not.toContain('validateConfig');
	});
});

describe('the edge binary', () => {
	it('carries routing and nothing else', () => {
		expect(surface('edge')).toEqual(['coreVersion', ...ROUTING].sort());
	});

	it.each(MESSAGES)('does not carry %s — the proxy never resolves messages', (name) => {
		expect(surface('edge')).not.toContain(name);
	});

	it('carries no serialiser at all', () => {
		// The point of the primitive boundary, and not visible from the export
		// list: `serde-wasm-bindgen` brings its own error strings with it, so
		// their absence is what proves it is gone.
		//
		// Read from `bytes.mjs` rather than a `.wasm`: the Edge binary is
		// embedded as base64 and the file is deleted, because the Edge runtime
		// has no base URL to resolve a sibling file against (ADR 0009).
		const module = readFileSync(`${wasm}edge/bytes.mjs`, 'utf8');
		const encoded = /const BASE64 = '([^']+)'/.exec(module)?.[1];

		if (!encoded) throw new Error('could not find the embedded binary in wasm/edge/bytes.mjs');

		const binary = Buffer.from(encoded, 'base64').toString('latin1');

		for (const marker of ['serde', 'invalid type', 'missing field', 'duplicate field']) {
			expect(binary, `the edge binary still contains "${marker}"`).not.toContain(marker);
		}
	});
});

describe('the node binary', () => {
	// The server routes and resolves messages in the same process, and the CLI
	// enumerates namespaces. It is read from disk, so its size costs nobody a
	// download.
	it('carries both halves', () => {
		for (const name of [...ROUTING, ...MESSAGES, 'validateConfig', 'coreVersion']) {
			expect(surface('node'), `node binary is missing ${name}`).toContain(name);
		}
	});
});

describe('the three builds are actually different', () => {
	// A build script that stopped distinguishing them would still pass every
	// test above if all three ended up identical to `node`.
	it('do not all carry the same surface', () => {
		const [browser, edge, node] = [surface('browser'), surface('edge'), surface('node')];

		expect(browser).not.toEqual(node);
		expect(edge).not.toEqual(node);
		expect(browser).not.toEqual(edge);
	});
});

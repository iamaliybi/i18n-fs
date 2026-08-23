/**
 * Node binding loader.
 *
 * Uses the `web`-target glue with the binary supplied as bytes rather than the
 * `nodejs` target, which locates its own `.wasm` through `__dirname`. Every
 * bundler rewrites `__dirname`: webpack to a chunk directory, Turbopack to a
 * placeholder root — and neither copies the binary there, so the failure lands
 * at request time as an ENOENT long after the build reported success.
 *
 * Embedding the bytes removes the question entirely. It works the same under
 * webpack, Turbopack, a plain `node` process and a workspace symlink, and
 * needs no configuration from the application.
 */

import type { Capability, CliCore } from './types.js';

export const CAPABILITY: Capability = 'full';

export async function loadBindings(): Promise<CliCore> {
	const [wasm, { wasmBytes }] = await Promise.all([
		import('../../wasm/node/i18n_fs_wasm.js'),
		import('../../wasm/node/bytes.mjs'),
	]);

	await wasm.default({ module_or_path: wasmBytes });

	return wasm as unknown as CliCore;
}

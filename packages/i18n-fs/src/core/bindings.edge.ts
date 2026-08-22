/**
 * Edge binding loader.
 *
 * The binary is embedded rather than imported as a module. The Edge runtime has
 * no base URL to resolve a relative path against, so the usual bundler glue
 * throws "Failed to parse URL from /_next/static/wasm/….wasm" on the first
 * request — a failure that appears only in production, only at request time,
 * and only for the middleware.
 *
 * Embedding also means an application needs no webpack configuration to make
 * middleware work, which is worth more than the bytes it costs: the Edge bundle
 * is never downloaded by a browser.
 *
 * This build is compiled with `--no-default-features`: it has locale
 * negotiation and route canonicalisation and nothing else. Message storage and
 * formatting are absent from the binary, not merely unreferenced.
 */

import type { Capability, EdgeCore } from './types.js';

export const CAPABILITY: Capability = 'edge';

export async function loadBindings(): Promise<EdgeCore> {
	const [wasm, { wasmBytes }] = await Promise.all([
		import('../../wasm/edge/i18n_fs_wasm.js'),
		import('../../wasm/edge/bytes.mjs'),
	]);

	await wasm.default({ module_or_path: wasmBytes });

	return wasm as unknown as EdgeCore;
}

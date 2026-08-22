/**
 * Edge binding loader.
 *
 * wasm-pack's `bundler` target imports the `.wasm` file directly, which is the
 * only shape the Next.js Edge runtime accepts. The bundler instantiates it, so
 * the exports are ready on import.
 *
 * This build is compiled with `--no-default-features`: it has locale
 * negotiation and route canonicalisation and nothing else. Message storage and
 * formatting are absent from the binary, not merely unreferenced.
 */

import type { Capability, EdgeCore } from './types.js';

export const CAPABILITY: Capability = 'edge';

export async function loadBindings(): Promise<EdgeCore> {
	const wasm = await import('../../wasm/edge/i18n_fs_wasm.js');
	return wasm as unknown as EdgeCore;
}

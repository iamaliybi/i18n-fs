/**
 * Node binding loader.
 *
 * wasm-pack's `nodejs` target emits CommonJS that instantiates the module on
 * require, so there is nothing to await. The dynamic import keeps this file
 * loadable from ESM.
 */

import type { Capability, FullCore } from './types.js';

export const CAPABILITY: Capability = 'full';

export async function loadBindings(): Promise<FullCore> {
	const wasm = await import('../../wasm/node/i18n_fs_wasm.js');
	return wasm as unknown as FullCore;
}

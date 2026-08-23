/**
 * Browser binding loader.
 *
 * This binary carries message resolution and formatting only — no routing. It
 * is the one a visitor downloads, so what is compiled into it is bytes on the
 * wire; see `MessageCore`.
 *
 * wasm-pack's `web` target does not instantiate on import: the default export
 * is an `init` function that fetches the `.wasm` file. `new URL(..., import.meta.url)`
 * lets the bundler fingerprint and emit that file rather than us hard-coding a
 * public path.
 */

import type { Capability, MessageCore } from './types.js';

export const CAPABILITY: Capability = 'messages';

export async function loadBindings(): Promise<MessageCore> {
	const wasm = await import('../../wasm/browser/i18n_fs_wasm.js');
	await wasm.default({
		module_or_path: new URL('../../wasm/browser/i18n_fs_wasm_bg.wasm', import.meta.url),
	});
	return wasm as unknown as MessageCore;
}

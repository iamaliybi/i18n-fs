/**
 * Loads the WebAssembly core for whichever runtime we are in.
 *
 * Which binary that is comes from the `#core-bindings` condition in
 * `package.json`: the bundler picks `edge`, `browser` or `node` at build time,
 * so no branching survives into the shipped code. The Edge middleware therefore
 * carries only the minimal binary.
 *
 * The promise is cached at module scope: instantiating a WebAssembly module is
 * the expensive part, and a per-call `await` on an already-resolved promise is
 * free.
 */

import { CAPABILITY, loadBindings } from '#core-bindings';
import type { EdgeCore, FullCore } from './types.js';

let pending: Promise<EdgeCore> | undefined;

/**
 * The core available in this runtime.
 *
 * Typed as {@link EdgeCore} because that is the only surface guaranteed to
 * exist everywhere. Use {@link loadFullCore} where message handling is needed.
 */
export function loadCore(): Promise<EdgeCore> {
	pending ??= loadBindings();
	return pending;
}

/**
 * The core including message storage and formatting.
 *
 * Rejects in the Edge runtime, where those functions were never compiled in.
 * Loading messages inside middleware is a design mistake rather than a missing
 * feature, so it fails loudly with the reason.
 */
export async function loadFullCore(): Promise<FullCore> {
	const core = await loadCore();

	if (CAPABILITY !== 'full') {
		throw new Error(
			'[i18n-fs] The Edge build of the core does not include message handling. ' +
				'Middleware resolves the locale; loading and formatting messages belongs ' +
				'in a Server Component or a Client Component.',
		);
	}

	return core as FullCore;
}

/** Whether this runtime's core can load and format messages. */
export function hasMessageSupport(): boolean {
	return CAPABILITY === 'full';
}

export type * from './types.js';

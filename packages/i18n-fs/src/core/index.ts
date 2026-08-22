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
import type { CliCore, EdgeCore, FullCore } from './types.js';

let pending: Promise<EdgeCore> | undefined;
let pendingFull: Promise<FullCore> | undefined;

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
export function loadFullCore(): Promise<FullCore> {
	// The same promise every time, not merely the same underlying work. React's
	// `use()` identifies a suspended read by promise identity, and an `async`
	// function returns a fresh promise per call — which would suspend forever.
	pendingFull ??= (async () => {
		const core = await loadCore();

		if (CAPABILITY !== 'full') {
			throw new Error(
				'[i18n-fs] The Edge build of the core does not include message handling. ' +
					'Middleware resolves the locale; loading and formatting messages belongs ' +
					'in a Server Component or a Client Component.',
			);
		}

		return core as FullCore;
	})();

	return pendingFull;
}

/**
 * The core including namespace introspection, for the build-time CLI.
 *
 * Only the Node build carries it. Rejects elsewhere rather than failing later
 * as `store.entries is not a function`.
 */
export async function loadCliCore(): Promise<CliCore> {
	const core = await loadFullCore();

	if (typeof (core.Store.prototype as { entries?: unknown }).entries !== 'function') {
		throw new Error(
			'[i18n-fs] Namespace introspection is compiled into the Node build of the ' +
				'core only. The CLI must run under Node.',
		);
	}

	return core as CliCore;
}

/** Whether this runtime's core can load and format messages. */
export function hasMessageSupport(): boolean {
	return CAPABILITY === 'full';
}

export type * from './types.js';

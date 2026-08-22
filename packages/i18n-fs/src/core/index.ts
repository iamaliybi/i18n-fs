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
import { VERSION } from '../version.js';
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
	pending ??= loadBindings().then(assertVersionsAgree);
	return pending;
}

/**
 * Refuse a binary built for a different version of this package.
 *
 * The two halves encode the same decisions — route canonicalisation, key
 * resolution, message parsing — and a `wasm/` directory left over from an
 * earlier version would apply the old ones while the JavaScript applies the
 * new. That produces wrong output rather than an error, which is the worst
 * shape a bug can take, so it is worth failing the load over.
 *
 * This cannot happen in a published package: both halves are built together.
 * It happens in development, when one side is rebuilt and the other is not.
 */
function assertVersionsAgree(core: EdgeCore): EdgeCore {
	const compiled = core.coreVersion();

	if (compiled !== VERSION) {
		throw new Error(
			`[i18n-fs] The compiled core is version ${compiled} but the package is ${VERSION}. ` +
				'The two encode the same routing and resolution rules, so a mismatch would ' +
				'silently produce wrong output. Run `pnpm bootstrap` to rebuild both.',
		);
	}

	return core;
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

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
import type { CliCore, EdgeCore, FullCore, MessageCore } from './types.js';

let pending: Promise<MessageCore | EdgeCore> | undefined;
let pendingRouting: Promise<EdgeCore> | undefined;
let pendingMessages: Promise<MessageCore> | undefined;

/**
 * The core available in this runtime.
 *
 * Typed as {@link EdgeCore} because that is the only surface guaranteed to
 * exist everywhere. Use {@link loadFullCore} where message handling is needed.
 */
export function loadCore(): Promise<EdgeCore> {
	pendingRouting ??= (async () => {
		const core = await loadAny();

		if (CAPABILITY === 'messages') {
			throw new Error(
				'[i18n-fs] The browser build of the core does not include routing. ' +
					'It is the binary a visitor downloads, so it carries message resolution ' +
					'only — use <Link>, useRouter and usePathname from "i18n-fs/navigation", ' +
					'which answer the same rules synchronously.',
			);
		}

		return core as EdgeCore;
	})();

	return pendingRouting;
}

/** Load whichever binary this runtime has, before any capability check. */
function loadAny(): Promise<MessageCore | EdgeCore> {
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
function assertVersionsAgree<T extends { coreVersion(): string }>(core: T): T {
	const compiled = core.coreVersion();

	if (compiled !== VERSION) {
		throw new Error(
			`[i18n-fs] The compiled core is version ${compiled} but the package is ${VERSION}. ` +
				'The two encode the same routing and resolution rules, so a mismatch would ' +
				'silently produce wrong output. Run `npm run bootstrap` to rebuild both.',
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
export function loadMessageCore(): Promise<MessageCore> {
	// The same promise every time, not merely the same underlying work. React's
	// `use()` identifies a suspended read by promise identity, and an `async`
	// function returns a fresh promise per call — which would suspend forever.
	pendingMessages ??= (async () => {
		const core = await loadAny();

		if (CAPABILITY === 'edge') {
			throw new Error(
				'[i18n-fs] The Edge build of the core does not include message handling. ' +
					'The proxy resolves the locale; loading and formatting messages belongs ' +
					'in a Server Component or a Client Component.',
			);
		}

		return core as MessageCore;
	})();

	return pendingMessages;
}

/**
 * The core with both halves. Node only.
 *
 * The browser binary carries messages without routing, so this is not the thing
 * to reach for in a Client Component — {@link loadMessageCore} is.
 */
export async function loadFullCore(): Promise<FullCore> {
	const core = await loadMessageCore();

	if (CAPABILITY !== 'full') {
		throw new Error(
			'[i18n-fs] Routing and message handling are compiled into the same binary ' +
				'only under Node. In the browser use loadMessageCore(); in the proxy use ' +
				'loadCore().',
		);
	}

	return core as FullCore;
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
	return CAPABILITY !== 'edge';
}

export type * from './types.js';

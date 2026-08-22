/**
 * Where the server layer gets its configuration.
 *
 * The CLI compiles `i18n-fs.config.ts` into `.i18n-fs/config.mjs` ([ADR 0005]).
 * The server can import that file itself, so the common case needs no wiring at
 * all — but the import is resolved from the working directory at runtime, which
 * some deployment layouts break. `configureI18n` is the escape hatch for those,
 * and for tests.
 */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { ResolvedI18nFsConfig } from '../config.js';

let registered: ResolvedI18nFsConfig | undefined;
let loading: Promise<ResolvedI18nFsConfig> | undefined;

/**
 * Register the configuration explicitly.
 *
 * Call this once, at module scope, from a file the app imports early — for
 * example the root layout. Registering twice with different values is a
 * mistake, so the second call wins and the previous cache is dropped.
 */
export function configureI18n(config: ResolvedI18nFsConfig): void {
	registered = config;
	loading = undefined;
}

/** Forget any registered or loaded configuration. Exposed for tests. */
export function resetI18nConfig(): void {
	registered = undefined;
	loading = undefined;
}

async function loadGeneratedConfig(): Promise<ResolvedI18nFsConfig> {
	const path = join(process.cwd(), '.i18n-fs', 'config.mjs');

	let module: { default?: unknown };
	try {
		// The specifier is computed so bundlers leave it alone and Node resolves
		// it at runtime, which is what we want: the file is generated per project.
		module = (await import(/* webpackIgnore: true */ pathToFileURL(path).href)) as {
			default?: unknown;
		};
	} catch (error) {
		throw new Error(
			`[i18n-fs] Could not load ${path}. Run \`i18n-fs build\` before starting the app, ` +
				'or call configureI18n() with the resolved configuration.',
			{ cause: error },
		);
	}

	if (!module.default || typeof module.default !== 'object') {
		throw new Error(`[i18n-fs] ${path} has no default export. Regenerate it with \`i18n-fs build\`.`);
	}

	return module.default as ResolvedI18nFsConfig;
}

/**
 * The active configuration.
 *
 * Cached as a promise rather than a value so concurrent requests during a cold
 * start share one import instead of racing to do the same work.
 */
export function getI18nConfig(): Promise<ResolvedI18nFsConfig> {
	if (registered) return Promise.resolve(registered);

	loading ??= loadGeneratedConfig();
	return loading;
}

/**
 * Finds, loads and resolves `i18n-fs.config.ts`.
 *
 * The config is imported directly rather than compiled with a bundler. Node
 * strips TypeScript types natively from 22.18 onward, which is why the package
 * requires that version — pulling in esbuild purely to read one config file
 * would make every consumer of the runtime pay for a build-time concern.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_DEFAULTS, type I18nFsConfig, type ResolvedI18nFsConfig } from '../config.js';

const CANDIDATES = [
	'i18n-fs.config.ts',
	'i18n-fs.config.mts',
	'i18n-fs.config.mjs',
	'i18n-fs.config.js',
];

/** Locate the config file, or return `undefined` if there is none. */
export function findConfig(cwd: string, explicit?: string): string | undefined {
	if (explicit) {
		const path = join(cwd, explicit);
		return existsSync(path) ? path : undefined;
	}

	return CANDIDATES.map((name) => join(cwd, name)).find((path) => existsSync(path));
}

/** Raised when the config cannot be read at all, as opposed to being invalid. */
export class ConfigLoadError extends Error {
	readonly path: string;

	constructor(message: string, path: string, options?: { cause: unknown }) {
		super(message, options);
		this.name = 'ConfigLoadError';
		this.path = path;
	}
}

/**
 * Stop Node's `MODULE_TYPELESS_PACKAGE_JSON` warning from reaching the user.
 *
 * Node emits it whenever it parses an ES module in a project whose package.json
 * has no `"type"` field — which is most Next.js projects. It is advice about
 * the user's own project, has nothing to do with reading a config file, and
 * printing it on every command would train people to ignore our output.
 *
 * Installed for the life of the process rather than around the import:
 * `process.emitWarning` defers to `nextTick`, so a filter that unwound
 * immediately after the import would be gone before the warning arrived.
 */
export function silenceTypelessPackageWarning(): void {
	const existing = process.listeners('warning');
	process.removeAllListeners('warning');

	process.on('warning', (warning: Error & { code?: string }) => {
		if (warning.code === 'MODULE_TYPELESS_PACKAGE_JSON') return;

		if (existing.length) {
			for (const listener of existing) listener(warning);
		} else {
			console.error(`${warning.name}: ${warning.message}`);
		}
	});
}

/** Import a config file and return its default export. */
export async function loadConfig(path: string): Promise<I18nFsConfig> {
	let module: { default?: unknown };

	try {
		module = (await import(pathToFileURL(path).href)) as { default?: unknown };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);

		if (detail.includes('Unknown file extension') || detail.includes('strip-types')) {
			throw new ConfigLoadError(
				`Could not load ${path}. Node could not read the TypeScript file directly. ` +
					'Use Node 22.18 or newer, or rename the config to i18n-fs.config.mjs.',
				path,
				{ cause: error },
			);
		}

		throw new ConfigLoadError(`Could not load ${path}: ${detail}`, path, { cause: error });
	}

	if (!module.default || typeof module.default !== 'object') {
		throw new ConfigLoadError(
			`${path} must have a default export. Wrap it in defineConfig() from 'i18n-fs/config'.`,
			path,
		);
	}

	return module.default as I18nFsConfig;
}

/**
 * Fill in every optional field.
 *
 * The result is what the CLI writes to disk and what every runtime receives, so
 * defaults are applied exactly once, here — not re-derived at each call site
 * where they could drift apart.
 */
export function resolveConfig(config: I18nFsConfig): ResolvedI18nFsConfig {
	return {
		locales: config.locales ?? [],
		defaultLocale: config.defaultLocale ?? '',
		strategy: config.strategy ?? CONFIG_DEFAULTS.strategy,
		prefix: config.prefix ?? CONFIG_DEFAULTS.prefix,
		domains: (config.domains ?? []).map((rule) => ({
			domain: rule.domain,
			locale: rule.locale,
			locales: rule.locales ?? [],
		})),
		cookie: {
			name: config.cookie?.name ?? CONFIG_DEFAULTS.cookie.name,
			maxAge: config.cookie?.maxAge ?? CONFIG_DEFAULTS.cookie.maxAge,
			sameSite: config.cookie?.sameSite ?? CONFIG_DEFAULTS.cookie.sameSite,
			path: config.cookie?.path ?? CONFIG_DEFAULTS.cookie.path,
			secure: config.cookie?.secure ?? CONFIG_DEFAULTS.cookie.secure,
		},
		messagesDir: config.messagesDir ?? CONFIG_DEFAULTS.messagesDir,
		debug: config.debug ?? process.env.NODE_ENV !== 'production',
	};
}

/**
 * Walks the message tree under `public/`.
 *
 * The folder layout beneath each locale directory is entirely the developer's,
 * so the scan imposes nothing: every `.json` file is a namespace, named by its
 * path relative to the locale directory.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ResolvedI18nFsConfig } from '../config.js';

/** One namespace file on disk. */
export interface MessageFile {
	locale: string;
	/** Path beneath the locale directory, without `.json`, always `/`-separated. */
	namespace: string;
	/** Absolute path, for diagnostics. */
	path: string;
	/** Path relative to the project root, for diagnostics people can act on. */
	displayPath: string;
	raw: string;
	/** First 8 hex characters of the SHA-256 of the file's bytes. */
	hash: string;
}

/** What a scan found. */
export interface ScanResult {
	root: string;
	files: MessageFile[];
	/** Configured locales with no directory of their own. */
	missingLocales: string[];
	/** Directories under the messages root that are not configured locales. */
	unknownLocales: string[];
}

/** The absolute path of the messages root for a project. */
export function messagesRoot(cwd: string, config: ResolvedI18nFsConfig): string {
	return join(cwd, 'public', config.messagesDir);
}

async function walk(dir: string): Promise<string[]> {
	const found: string[] = [];

	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);

		if (entry.isDirectory()) {
			found.push(...(await walk(path)));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			found.push(path);
		}
	}

	return found;
}

/** Read every namespace file for every configured locale. */
export async function scan(cwd: string, config: ResolvedI18nFsConfig): Promise<ScanResult> {
	const root = messagesRoot(cwd, config);

	if (!existsSync(root)) {
		return {
			root,
			files: [],
			missingLocales: [...config.locales],
			unknownLocales: [],
		};
	}

	const present = (await readdir(root, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);

	const missingLocales = config.locales.filter(
		(locale) => !present.some((dir) => dir.toLowerCase() === locale.toLowerCase()),
	);
	const unknownLocales = present.filter(
		(dir) => !config.locales.some((locale) => locale.toLowerCase() === dir.toLowerCase()),
	);

	const files: MessageFile[] = [];

	for (const locale of config.locales) {
		// Match the directory case-insensitively but keep the configured
		// spelling: everything downstream keys caches and URLs by locale, and
		// two spellings of one locale would be two different caches.
		const dir = present.find((entry) => entry.toLowerCase() === locale.toLowerCase());
		if (!dir) continue;

		const localeRoot = join(root, dir);

		for (const path of await walk(localeRoot)) {
			const raw = await readFile(path, 'utf8');

			files.push({
				locale,
				namespace: relative(localeRoot, path).slice(0, -'.json'.length).split(sep).join('/'),
				path,
				displayPath: relative(cwd, path).split(sep).join('/'),
				raw,
				hash: createHash('sha256').update(raw).digest('hex').slice(0, 8),
			});
		}
	}

	return { root, files, missingLocales, unknownLocales };
}

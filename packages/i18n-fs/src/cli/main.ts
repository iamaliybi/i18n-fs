/**
 * The `i18n-fs` command-line interface.
 *
 * Two commands:
 *
 *   i18n-fs check    validate the config and the message tree; exit non-zero
 *                    if anything is wrong
 *   i18n-fs build    run the same checks, then write `.i18n-fs/`
 *
 * `build` refuses to write when `check` finds an error, so a broken message
 * tree cannot produce a manifest and types that quietly disagree with it.
 */

import { loadCliCore } from '../core/index.js';
import { outputDir, writeArtefacts, type NamespaceKeys } from './build.js';
import { check, type Finding } from './check.js';
import {
	ConfigLoadError,
	findConfig,
	loadConfig,
	resolveConfig,
	silenceTypelessPackageWarning,
} from './config.js';
import { scan } from './scan.js';
import type { ResolvedI18nFsConfig } from '../config.js';

interface Options {
	command: 'check' | 'build' | 'help';
	cwd: string;
	config?: string;
	out?: string;
	strict: boolean;
	/** `--compare-locales` / `--no-compare-locales`, overriding the config. */
	compareLocales?: boolean;
	json: boolean;
}

const USAGE = `i18n-fs — folder-based i18n for Next.js

Usage:
  i18n-fs check [options]    Validate the config and the message tree
  i18n-fs build [options]    Check, then write .i18n-fs/

Options:
  --cwd <dir>       Project root (default: the current directory)
  --config <file>   Config file, relative to --cwd (default: i18n-fs.config.ts)
  --out <dir>       Output directory for build (default: .i18n-fs)
  --strict          Treat warnings as errors
  --compare-locales     Compare every locale against the default one, whatever
                        the config says. Use it to audit a project that has
                        compareLocales turned off.
  --no-compare-locales  Skip that comparison for this run.
  --json            Emit findings as JSON
  -h, --help        Show this message

Exit codes:
  0  no errors
  1  errors found, or the config could not be read
`;

function parse(argv: string[]): Options {
	const options: Options = {
		command: 'help',
		cwd: process.cwd(),
		strict: false,
		json: false,
	};

	const rest = [...argv];
	const first = rest[0];

	if (first === 'check' || first === 'build') {
		options.command = first;
		rest.shift();
	} else if (first && !first.startsWith('-')) {
		throw new Error(`Unknown command "${first}". Run \`i18n-fs --help\`.`);
	}

	while (rest.length) {
		const flag = rest.shift();

		switch (flag) {
			case '-h':
			case '--help':
				options.command = 'help';
				break;
			case '--compare-locales':
				options.compareLocales = true;
				break;

			case '--no-compare-locales':
				options.compareLocales = false;
				break;

			case '--strict':
				options.strict = true;
				break;
			case '--json':
				options.json = true;
				break;
			case '--cwd':
			case '--config':
			case '--out': {
				const value = rest.shift();
				if (!value) throw new Error(`${flag} needs a value.`);
				if (flag === '--cwd') options.cwd = value;
				if (flag === '--config') options.config = value;
				if (flag === '--out') options.out = value;
				break;
			}
			default:
				throw new Error(`Unknown option "${flag}". Run \`i18n-fs --help\`.`);
		}
	}

	return options;
}

function report(findings: Finding[], strict: boolean): void {
	for (const finding of findings) {
		const label = finding.severity === 'error' ? 'error' : 'warning';
		const where = finding.file ? ` (${finding.file})` : '';

		console.error(`${label}  ${finding.code}  ${finding.message}${where}`);

		for (const detail of finding.details ?? []) {
			console.error(`         ${detail}`);
		}
	}

	const errors = findings.filter((f) => f.severity === 'error').length;
	const warnings = findings.length - errors;

	if (!findings.length) {
		console.log('No problems found.');
		return;
	}

	const summary = [
		errors ? `${errors} error(s)` : undefined,
		warnings ? `${warnings} warning(s)` : undefined,
	]
		.filter(Boolean)
		.join(', ');

	console.error(`\n${summary}${strict && warnings ? ' (warnings are errors under --strict)' : ''}`);
}

function hasFailure(findings: Finding[], strict: boolean): boolean {
	return findings.some((f) => f.severity === 'error' || (strict && f.severity === 'warning'));
}

async function run(options: Options): Promise<number> {
	const configPath = findConfig(options.cwd, options.config);

	if (!configPath) {
		console.error(
			`error  CONFIG_NOT_FOUND  No i18n-fs config found in ${options.cwd}.\n` +
				'         Create i18n-fs.config.ts with a default export from defineConfig().',
		);
		return 1;
	}

	const loaded = resolveConfig(await loadConfig(configPath));

	// The flag overrides the configured value for the whole run rather than for
	// the comparison alone. The registry's shape is derived from this setting —
	// merged when locales are not compared, the default locale's when they are —
	// so overriding only the check would report against one set of rules and
	// generate against another.
	const config: ResolvedI18nFsConfig =
		options.compareLocales === undefined
			? loaded
			: { ...loaded, compareLocales: options.compareLocales };
	const core = await loadCliCore();
	const scanned = await scan(options.cwd, config);
	const { findings, parsed } = check(core, config, scanned);

	if (options.json) {
		console.log(JSON.stringify({ config: configPath, findings }, null, '\t'));
	} else {
		report(findings, options.strict);
	}

	const failed = hasFailure(findings, options.strict);

	if (options.command === 'check' || failed) {
		if (failed && options.command === 'build' && !options.json) {
			console.error('\nNot writing .i18n-fs/ — fix the errors above first.');
		}
		return failed ? 1 : 0;
	}

	const namespaces: NamespaceKeys[] = parsed.map((item) => ({
		locale: item.file.locale,
		namespace: item.file.namespace,
		hash: item.file.hash,
		entries: item.entries,
	}));

	// Scopes follow the same rule as keys: the default locale's when the locales
	// are compared, the union of all of them when they are not. Taking only the
	// default locale's here would have left a scope that exists solely in
	// another language untyped, which is the same defect the merged registry
	// exists to avoid.
	const scopes = new Map<string, string[]>();
	for (const item of parsed) {
		if (config.compareLocales && item.file.locale !== config.defaultLocale) continue;

		const existing = scopes.get(item.file.namespace);
		scopes.set(
			item.file.namespace,
			existing ? [...new Set([...existing, ...item.scopes])].sort() : item.scopes,
		);
	}

	const dir = outputDir(options.cwd, options.out);
	const written = await writeArtefacts(dir, config, namespaces, scopes);

	if (!options.json) {
		for (const path of written) {
			console.log(`wrote ${path}`);
		}
	}

	return 0;
}

async function main(): Promise<void> {
	silenceTypelessPackageWarning();

	let options: Options;

	try {
		options = parse(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
		return;
	}

	if (options.command === 'help') {
		console.log(USAGE);
		return;
	}

	try {
		process.exitCode = await run(options);
	} catch (error) {
		if (error instanceof ConfigLoadError) {
			console.error(`error  CONFIG_UNREADABLE  ${error.message}`);
		} else {
			console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
		}
		process.exitCode = 1;
	}
}

await main();

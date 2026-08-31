// Checks that the documentation describes the package that actually exists.
//
// Documentation naming a function that was renamed is worse than none: it sends
// someone looking for something that is not there, and they conclude the package
// is broken rather than the docs. This runs in CI for the same reason the type
// checker does.
//
// Three things are verified:
//
//   1. every relative link in every markdown file resolves to a real file;
//   2. every export the guides promise exists in the built declarations;
//   3. the error code table matches `src/errors.ts` exactly.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'packages', 'i18n-fs');
const problems = [];

const SKIP = ['node_modules', '.git', 'target', '.next', 'dist', '.i18n-fs'];

function walk(dir, match, found = []) {
	for (const entry of readdirSync(dir)) {
		if (SKIP.includes(entry)) continue;

		const path = join(dir, entry);
		if (statSync(path).isDirectory()) walk(path, match, found);
		else if (match(entry)) found.push(path);
	}
	return found;
}

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const EXTERNAL = /^(https?:|#|mailto:)/;

// The README shipped to npm is generated from the root one with absolute links,
// because npm resolves relative links against the package's directory in the
// repository — where `docs/…` does not exist.
const published = normalize(join(pkg, 'README.md'));

const markdown = walk(root, (name) => name.endsWith('.md'));

for (const path of markdown) {
	const text = readFileSync(path, 'utf8');
	const where = relative(root, path).replaceAll('\\', '/');

	for (const [, label, target] of text.matchAll(LINK)) {
		if (normalize(path) === published) {
			if (!EXTERNAL.test(target)) {
				problems.push(`${where}: relative link [${label}](${target}) would 404 on npm`);
			}
			continue;
		}

		if (EXTERNAL.test(target)) continue;

		const file = target.split('#')[0];
		if (!file) continue;

		if (!existsSync(resolve(dirname(path), file))) {
			problems.push(`${where}: broken link [${label}](${target})`);
		}
	}
}

// Names the guides promise. A missing one is an import error for whoever follows
// the documentation.
const EXPECTED = [
	'ErrorCode', 'errorCodeName', 'isErrorCode', 'isNamespaceError', 'isLookupError',
	'ERROR_CODE_NAMES', 'VERSION', 'getI18nConfig',
	'getTranslation', 'getLocale', 'getResolvedLocale', 'setRequestLocale',
	'I18nProvider', 'configureI18n', 'getPathname', 'permanentRedirect',
	'useTranslation', 'useLocale', 'useI18nContext', 'usePrefetch',
	'getFormatter', 'useFormatter', 'createFormatter', 'Formatter',
	'Link', 'useRouter', 'usePathname', 'useLocaleSwitcher',
	'createI18nProxy', 'createI18nMiddleware', 'I18nProxyHandler',
	'LOCALE_HEADER', 'RESOLVED_HEADER', 'RECOMMENDED_MATCHER',
	'defineConfig', 'withI18nFs',
	'loadCore', 'loadMessageCore', 'loadFullCore', 'hasMessageSupport', 'MessageCore',
];

const dist = join(pkg, 'dist');

if (!existsSync(dist)) {
	problems.push('dist/ is missing — run `npm run build` before checking the documentation');
} else {
	const declarations = walk(dist, (name) => name.endsWith('.d.ts'), [])
		.map((path) => readFileSync(path, 'utf8'))
		.join('\n');

	for (const name of EXPECTED) {
		if (!new RegExp(`\\b${name}\\b`).test(declarations)) {
			problems.push(`documented but not exported: ${name}`);
		}
	}

	// The list above only proves the names we remembered to list still exist.
	// This catches the other direction — a heading in the reference naming
	// something that does not — which is how a rename leaves documentation
	// behind while every test still passes.
	const reference = readFileSync(join(root, 'docs', 'guide', 'api.md'), 'utf8');

	for (const [, heading] of reference.matchAll(/^### (.+)$/gm)) {
		for (const [, span] of heading.matchAll(/`([^`]+)`/g)) {
			const identifier = /^<?([A-Za-z_$][\w$]*)/.exec(span)?.[1];
			if (!identifier) continue;

			if (!new RegExp(`\\b${identifier}\\b`).test(declarations)) {
				problems.push(`docs/guide/api.md documents "${identifier}", which is not exported`);
			}
		}
	}
}

// The error table is the kind of thing that rots quietly: renumbering a code is
// a one-line change nobody thinks to mirror in prose.
const NAMES = {
	NamespaceNotFound: 'NAMESPACE_NOT_FOUND',
	InvalidJson: 'INVALID_JSON',
	ScopeNotFound: 'SCOPE_NOT_FOUND',
	KeyNotFound: 'KEY_NOT_FOUND',
	TypeMismatch: 'TYPE_MISMATCH',
	ParamMissing: 'PARAM_MISSING',
	PluralNotNumeric: 'PLURAL_NOT_NUMERIC',
	NoMatchingArm: 'NO_MATCHING_ARM',
	InvalidConfig: 'INVALID_CONFIG',
};

const source = readFileSync(join(pkg, 'src', 'errors.ts'), 'utf8');
const codes = [...source.matchAll(/^\t(\w+): (\d+),$/gm)];
const errorsDoc = readFileSync(join(root, 'docs', 'guide', 'errors.md'), 'utf8');

for (const [, member, value] of codes) {
	const name = NAMES[member];
	if (!name) {
		problems.push(`errors.ts defines ${member}, which this check does not know about`);
		continue;
	}
	if (!errorsDoc.includes(`| \`${value}\` | \`${name}\` |`)) {
		problems.push(`docs/guide/errors.md does not document ${name} as ${value}`);
	}
}

if (codes.length !== Object.keys(NAMES).length) {
	problems.push(`errors.ts defines ${codes.length} codes; expected ${Object.keys(NAMES).length}`);
}

// The guide quotes the advice these diagnostics print. Quoted output is worse
// than none once it drifts: the reader searches the console for a sentence that
// is not there any more and concludes they are looking at the wrong problem.
const ADVICE = [
	['src/client/namespaces.ts', 'this result is kept until the page is reloaded'],
	['src/client/namespaces.ts', 'if a reload still shows it, restart the dev server'],
	['src/server/messages.ts', 'the file is re-read when it changes; restart the dev server if this persists'],
	['src/server/messages.ts', 'the server keeps this result until it restarts'],
	// The guide prints a sample console line. It drifted once — it carried two
	// sentences the reporter has never emitted — because nothing compared it.
	['src/report.ts', 'does not exist in'],
];

// Compared with whitespace collapsed, so prose stays free to wrap: the sentence
// is the contract, not where the line happens to break.
const flat = (text) => text.replace(/\s+/g, ' ');
const flatDoc = flat(errorsDoc);

for (const [file, sentence] of ADVICE) {
	if (!flat(readFileSync(join(pkg, file), 'utf8')).includes(flat(sentence))) {
		problems.push(`${file} no longer prints "${sentence}", which docs/guide/errors.md quotes`);
	}

	if (!flatDoc.includes(flat(sentence))) {
		problems.push(`docs/guide/errors.md does not quote "${sentence}" from ${file}`);
	}
}

if (problems.length) {
	console.error('Documentation does not match the package:\n');
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log(
	`${markdown.length} markdown files: links resolve, ${EXPECTED.length} exports present, ` +
		`${codes.length} error codes documented.`,
);

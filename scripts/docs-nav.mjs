// Generates the reading chain that links the guides together.
//
// The guides were written as eight separate pages and linked only from the
// index, so reaching the end of one was a dead end: you went back, found the
// table, and picked the next. That is a fine way to look something up and a
// poor way to read.
//
// The chain is generated rather than written by hand for the same reason the
// size table is: a footer maintained by hand is correct on the day it is
// written. Inserting a page means editing two neighbours, and the one time
// somebody forgets, the sequence quietly has a hole in it.
//
//   node scripts/docs-nav.mjs           write the footers
//   node scripts/docs-nav.mjs --check   fail if they are not current
//
// `--check` runs in CI.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const guides = join(root, 'docs', 'guide');

/**
 * The guides in reading order.
 *
 * Deliberately not alphabetical and not the order they were written: this is
 * the order someone meets the ideas in. Setup, then where files go, then
 * reading a message, then the two things a message needs that are not
 * translation, then how the URL carries the locale, then the piece that makes
 * routing work, then the build-time tools, then what happens when something is
 * wrong, then the reference to come back to.
 */
const ORDER = [
	{ file: 'getting-started.md', title: 'Getting started' },
	{ file: 'folder-structure.md', title: 'Folder structure' },
	{ file: 'translating.md', title: 'Translating' },
	{ file: 'plurals-and-formatting.md', title: 'Plurals and formatting' },
	{ file: 'routing.md', title: 'Routing' },
	{ file: 'proxy.md', title: 'The proxy' },
	{ file: 'cli.md', title: 'The CLI' },
	{ file: 'errors.md', title: 'Errors and fallbacks' },
	{ file: 'api.md', title: 'API reference' },
];

const START = '<!-- nav:start -->';
const END = '<!-- nav:end -->';

/** The footer for one page: where you came from, where the list is, what is next. */
function footer(index) {
	const previous = ORDER[index - 1];
	const next = ORDER[index + 1];

	const left = previous ? `← [${previous.title}](./${previous.file})` : '';
	const right = next ? `[${next.title}](./${next.file}) →` : '';

	// A three-cell row so the middle stays put whether or not both ends exist —
	// the first and last pages would otherwise shift the contents link around.
	return [
		START,
		'',
		'---',
		'',
		'| | | |',
		'| :-- | :--: | --: |',
		`| ${left} | [All guides](../README.md) | ${right} |`,
		'',
		END,
	].join('\n');
}

/** Replace an existing footer, or append one. */
function apply(text, block) {
	const from = text.indexOf(START);
	const to = text.indexOf(END);

	if (from !== -1 && to !== -1) {
		return text.slice(0, from) + block + text.slice(to + END.length);
	}

	return `${text.replace(/\s+$/, '')}\n\n${block}\n`;
}

const check = process.argv.includes('--check');
const stale = [];

ORDER.forEach((guide, index) => {
	const path = join(guides, guide.file);
	const current = readFileSync(path, 'utf8');
	const wanted = apply(current, footer(index));

	if (current === wanted) return;

	if (check) stale.push(guide.file);
	else writeFileSync(path, wanted);
});

if (check && stale.length) {
	console.error('These guides do not carry the current navigation footer:\n');
	for (const file of stale) console.error(`  - docs/guide/${file}`);
	console.error('\nRun `npm run docs:nav` and commit the result.');
	process.exit(1);
}

console.log(
	check
		? `All ${ORDER.length} guides carry the current navigation footer.`
		: `Linked ${ORDER.length} guides in reading order.`,
);

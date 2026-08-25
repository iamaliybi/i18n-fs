// Creates a GitHub release for every published version, from the changelog.
//
// `changeset publish` writes a git tag and nothing else. When publishing ran in
// CI, `changesets/action` pushed that tag and opened a GitHub release as part of
// the same step — but that step only runs when an npm credential is present, and
// publishing here is manual. So five versions reached npm with no tag and no
// release on GitHub, and nobody could tell which commit `0.6.1` was.
//
// The notes are the changelog's own section for that version, verbatim. Writing
// them again by hand would produce a second description of the same release,
// free to disagree with the first.
//
//   node scripts/github-releases.mjs           report what is missing
//   node scripts/github-releases.mjs --create  create the missing ones
//
// Existing releases are never edited: this fills gaps, it does not overwrite
// anything a person may have written.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const changelog = join(root, 'packages', 'i18n-fs', 'CHANGELOG.md');

const create = process.argv.includes('--create');

/**
 * Run a command and return its output, or throw with what it said.
 *
 * Nothing goes through a shell. Release notes are paragraphs of Markdown, and
 * the first version of this passed them as an argument with `shell: true` — it
 * failed with "no matches found for `Minor`", which is a changelog heading
 * being read as a glob. Notes go through a file now, and only `gh` is spawned:
 * it is a real executable on every platform, unlike `npm`.
 *
 * An earlier version also swallowed spawn failures and reported "0 versions",
 * which reads like "nothing to do" — the worst way for a tool to fail.
 */
function run(command, args) {
	try {
		return execFileSync(command, args, {
			cwd: root,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
			.toString()
			.trim();
	} catch (error) {
		throw new Error(
			`\`${command} ${args.join(' ')}\` failed:\n${String(error.stderr ?? error.message).trim()}`,
		);
	}
}

/** The changelog split into one entry per version. */
function entries() {
	const text = readFileSync(changelog, 'utf8');
	const found = new Map();

	// `## 1.2.3` starts a section and runs until the next one.
	const headings = [...text.matchAll(/^## (\d+\.\d+\.\d+)\s*$/gm)];

	headings.forEach((heading, index) => {
		const start = heading.index + heading[0].length;
		const end = index + 1 < headings.length ? headings[index + 1].index : text.length;
		found.set(heading[1], text.slice(start, end).trim());
	});

	return found;
}

const notes = entries();

// Straight from the registry rather than through `npm view`. On Windows `npm` is
// a `.cmd`, which Node refuses to spawn without a shell and which a shell then
// has to quote — an HTTP request has none of that and needs nothing installed.
const published = await fetch('https://registry.npmjs.org/i18n-fs')
	.then((response) => {
		if (!response.ok) throw new Error(`the registry answered ${response.status}`);
		return response.json();
	})
	.then((data) => Object.keys(data.versions ?? {}));
const releases = new Set(
	JSON.parse(run('gh', ['release', 'list', '--limit', '200', '--json', 'tagName'])).map(
		(release) => release.tagName,
	),
);

if (!published.length) {
	throw new Error('npm reported no published versions, which cannot be right');
}

// From the remote, not the local clone. This is the distinction that matters:
// every one of those five tags was present locally the whole time, unpushed, so
// a check of `git tag --list` would have passed throughout.
const remoteTags = new Set(
	run('git', ['ls-remote', '--tags', 'origin'])
		.split('\n')
		.map((line) => line.split('\t')[1] ?? '')
		.filter((ref) => ref.startsWith('refs/tags/') && !ref.endsWith('^{}'))
		.map((ref) => ref.slice('refs/tags/'.length)),
);

const missing = [];
const untagged = [];

for (const version of published) {
	const tag = `i18n-fs@${version}`;

	if (!remoteTags.has(tag)) untagged.push(tag);

	if (releases.has(tag)) continue;

	if (!notes.has(version)) {
		console.error(`  ${tag}: published, but the changelog has no section for it`);
		continue;
	}

	missing.push({ tag, version, body: notes.get(version) });
}

if (untagged.length) {
	console.error('Published versions with no tag on the remote:\n');
	for (const tag of untagged) console.error(`  - ${tag}`);
	console.error(
		`\nA tag names a commit, so guessing one is not this script's business. ` +
			`Push the tags the publish already made:\n\n  git push origin ${untagged.join(' ')}\n`,
	);
}

if (!missing.length) {
	if (!untagged.length) {
		console.log(`Every published version has a tag and a release (${published.length} versions).`);
	}
	process.exit(untagged.length ? 1 : 0);
}

if (!create) {
	console.log('Published versions with no GitHub release:\n');
	for (const { tag } of missing) console.log(`  - ${tag}`);
	console.log('\nRun `node scripts/github-releases.mjs --create` to add them.');
	process.exit(0);
}

// Oldest first, so the newest ends up marked as latest.
const latest = published[published.length - 1];

// Notes go through a file, never an argument. They are paragraphs of Markdown
// with backticks and asterisks in them, and an argument is one quoting mistake
// away from being reinterpreted by something.
const scratch = mkdtempSync(join(tmpdir(), 'i18n-fs-release-'));

for (const { tag, version, body } of missing.reverse()) {
	const file = join(scratch, `${version}.md`);
	writeFileSync(file, `${body}
`);

	const args = [
		'release',
		'create',
		tag,
		'--title',
		tag,
		'--notes-file',
		file,
		version === latest ? '--latest' : '--latest=false',
	];

	const url = run('gh', args);
	console.log(`  created ${tag}  ${url}`);
}

rmSync(scratch, { recursive: true, force: true });

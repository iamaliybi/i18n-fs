/**
 * The executable, and the wiring that puts it on PATH.
 *
 * `bin` used to point at `dist/cli/main.js`, which is generated. A package
 * manager links a bin during install, and npm does it by creating the link and
 * then marking the target executable — on Linux and macOS that chmod fails with
 * ENOENT when the target is not there yet, and npm skips the link silently.
 * pnpm skipped it too, which is what `scripts/relink.mjs` and a second install
 * existed to paper over.
 *
 * Windows has no chmod step, so the shim was written anyway and the whole class
 * of problem was invisible on the development machine. It reached CI as
 * `i18n-fs: not found` on every example build, with nothing pointing at the
 * cause. These tests fail on the machine instead.
 */

import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const pkg = fileURLToPath(new URL('../', import.meta.url));
const root = join(pkg, '..', '..');

const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')) as {
	bin: Record<string, string>;
	files: string[];
};

const targets = Object.values(manifest.bin);
const [launcher] = targets;

if (!launcher) throw new Error('package.json declares no bin');

const created: string[] = [];

afterEach(async () => {
	await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Run a script with node and capture its result, whether it succeeds or not. */
async function node(script: string, args: string[] = []) {
	try {
		const { stdout, stderr } = await run(process.execPath, [script, ...args]);
		return { code: 0, stdout, stderr };
	} catch (error) {
		const failure = error as { code?: number; stdout?: string; stderr?: string };
		return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
	}
}

describe('the bin target', () => {
	it('is declared', () => {
		expect(targets).toHaveLength(1);
	});

	it.each(targets)('%s exists in the repository, not only after a build', (target) => {
		expect(existsSync(join(pkg, target))).toBe(true);
	});

	it.each(targets)('%s is not generated output', (target) => {
		// The whole defect in one assertion: anything under `dist/` is absent
		// during a first install, so the link is never made.
		expect(target).not.toMatch(/^\.?\/?dist\//);
	});

	it.each(targets)('%s is executable as a script', (target) => {
		expect(readFileSync(join(pkg, target), 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
	});

	it.each(targets)('%s is published', (target) => {
		// `files` is an allowlist. A bin left out of it installs as a broken
		// link for everyone who installs from npm, while working in the repo.
		const top = target.replace(/^\.?\//, '').split('/')[0];
		expect(manifest.files).toContain(top);
	});
});

describe('the lockfile agrees with the manifest', () => {
	// `npm ci` takes a package's bin from the lockfile, not from its
	// package.json. Changing `bin` without regenerating the lockfile leaves the
	// old path in place, and the link silently is not made — which is how this
	// was first missed.
	it('records the same bin', () => {
		const lockfile = join(root, 'package-lock.json');
		expect(existsSync(lockfile)).toBe(true);

		const lock = JSON.parse(readFileSync(lockfile, 'utf8')) as {
			packages: Record<string, { bin?: Record<string, string> }>;
		};

		const entry = lock.packages['packages/i18n-fs'];
		if (!entry) throw new Error('the lockfile has no entry for packages/i18n-fs');

		const normalise = (bin: Record<string, string>) =>
			Object.fromEntries(Object.entries(bin).map(([name, path]) => [name, path.replace(/^\.\//, '')]));

		expect(normalise(entry.bin ?? {})).toEqual(normalise(manifest.bin));
	});
});

describe('running it', () => {
	it('hands over to the built CLI', async () => {
		const built = join(pkg, 'dist', 'cli', 'main.js');
		expect(existsSync(built), 'run `npm run build` before the tests').toBe(true);

		const result = await node(join(pkg, launcher), ['--help']);

		expect(result.code).toBe(0);
		expect(result.stdout).toContain('folder-based i18n for Next.js');
	});

	it('says what is wrong when the package is installed but not built', async () => {
		// Copied somewhere with no sibling `dist`, which is exactly the state of
		// a fresh clone before `npm run bootstrap`.
		const dir = await mkdtemp(join(tmpdir(), 'i18n-fs-bin-'));
		created.push(dir);

		const source = join(pkg, launcher);
		const copy = join(dir, basename(source));
		await copyFile(source, copy);

		const result = await node(copy, ['build']);

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('not built');
		// A stack trace would send someone looking for a bug in the CLI.
		expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
	});

	it('does not swallow a failure from the CLI itself', async () => {
		const result = await node(join(pkg, launcher), ['no-such-command']);

		expect(result.code).not.toBe(0);
		expect(result.stderr + result.stdout).not.toContain('not built');
	});
});

describe('the repository is on one package manager', () => {
	// A reintroduced pnpm lockfile would install a different tree than CI does,
	// and the two would drift without anything saying so.
	it.each(['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock'])('has no %s', (file) => {
		expect(existsSync(join(root, file))).toBe(false);
	});

	it('declares no workspace: protocol dependencies', () => {
		// `workspace:*` is a pnpm/yarn protocol; npm does not understand it and
		// installs fail outright.
		for (const example of ['next-16-proxy', 'next-15-middleware']) {
			const text = readFileSync(join(root, 'examples', example, 'package.json'), 'utf8');
			expect(text, `${example} still uses the workspace: protocol`).not.toContain('workspace:');
		}
	});
});

describe('the example apps', () => {
	// Each example pins a different Next.js major, and a hoisting package
	// manager puts exactly one of them at the workspace root. Resolving from the
	// example's own manifest is the only way that stays correct — the runner
	// used to spawn `<example>/node_modules/next/…` as a literal path, which
	// breaks for whichever one gets hoisted.
	it.each([
		['next-16-proxy', 16],
		['next-15-middleware', 15],
	])('%s resolves Next.js %i', async (example, major) => {
		const dir = join(root, 'examples', example);
		const require_ = (await import('node:module')).createRequire(join(dir, 'package.json'));
		const resolved = require_.resolve('next/package.json');
		const version = JSON.parse(readFileSync(resolved, 'utf8')) as { version: string };

		expect(Number(version.version.split('.')[0])).toBe(major);
		expect(existsSync(join(dirname(resolved), 'dist', 'bin', 'next'))).toBe(true);
	});
});

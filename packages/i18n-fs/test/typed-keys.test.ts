/**
 * That the generated key registry is actually connected to `t`.
 *
 * `i18n-fs build` has always written `.i18n-fs/messages.d.ts`, listing every
 * namespace, scope and key. Nothing read it: `getTranslation` took a `string`
 * and `t` took a `string`, so a mistyped key compiled and the README's promise
 * that "a renamed key is a compile error" was false for four published
 * versions. It was generated correctly and inert.
 *
 * Types cannot be checked by running code, so these compile a small program
 * against a registry and assert on what `tsc` says about it. A test that only
 * called `t('title')` would pass whether or not any of this works.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const pkg = fileURLToPath(new URL('../', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

let work: string;

/** A registry describing one namespace with text keys, a list, and two scopes. */
const REGISTRY = `
import type {} from 'i18n-fs';

declare module 'i18n-fs' {
	interface MessageRegistry {
		'app': {
			'': { text: 'hero.title' | 'nav.settings'; list: 'hero.bullets' };
			'hero': { text: 'title'; list: 'bullets' };
			'nav': { text: 'settings'; list: never };
		};
	}
}
`;

beforeAll(() => {
	work = mkdtempSync(join(tmpdir(), 'i18n-fs-types-'));
	mkdirSync(join(work, 'registry'), { recursive: true });

	writeFileSync(join(work, 'registry', 'messages.d.ts'), REGISTRY);
	writeFileSync(
		join(work, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				target: 'ES2022',
				lib: ['ES2022', 'dom'],
				module: 'esnext',
				moduleResolution: 'bundler',
				strict: true,
				noEmit: true,
				jsx: 'react-jsx',
				skipLibCheck: true,
				types: [],
				paths: { 'i18n-fs': [join(pkg, 'src/index.ts')], 'i18n-fs/*': [join(pkg, 'src/*')] },
			},
			include: ['*.ts', 'registry/*.d.ts'],
		}),
	);
});

afterAll(() => {
	rmSync(work, { recursive: true, force: true });
});

/** Type-check one snippet and return what `tsc` said, if anything. */
function check(body: string, { withRegistry = true } = {}): string {
	// Resolved through the `paths` mapping in the generated tsconfig, so the
	// probe imports the package the way an application does.
	writeFileSync(
		join(work, 'probe.ts'),
		`import { getTranslation, unknownKey } from 'i18n-fs/server';\nvoid unknownKey;\n${body}\n`,
	);

	// The registry is included by tsconfig; renaming it is how the "no build has
	// run" case is exercised without a second project.
	const registry = join(work, 'registry', 'messages.d.ts');
	writeFileSync(registry, withRegistry ? REGISTRY : 'export {};\n');

	try {
		execFileSync(process.execPath, [tsc, '--noEmit', '-p', work], { stdio: 'pipe' });
		return '';
	} catch (error) {
		const failure = error as { stdout?: Buffer };
		return String(failure.stdout ?? '')
			.split(/\r?\n/)
			.filter((line) => line.includes('probe.ts'))
			.join('\n');
	}
}

describe('with a generated registry', () => {
	it('accepts every key that exists', () => {
		expect(
			check(`
				const t = await getTranslation('app', 'hero');
				t('title');
				t.array('bullets');
				t.has('title');
				t.raw('bullets');

				const root = await getTranslation('app');
				root('hero.title');
				root('nav.settings');
			`),
		).toBe('');
	});

	it('rejects a mistyped key, naming what was expected', () => {
		const output = check(`
			const t = await getTranslation('app', 'hero');
			t('titel');
		`);

		expect(output).toContain('TS2345');
		expect(output).toContain(`"titel"`);
		expect(output).toContain(`"title"`);
	});

	it('rejects a namespace that does not exist', () => {
		expect(check(`await getTranslation('nope');`)).toContain(`"nope"`);
	});

	it('rejects a scope that does not exist', () => {
		const output = check(`await getTranslation('app', 'heroo');`);

		expect(output).toContain('TS2345');
		// The message lists the scopes there are, which is the useful part.
		expect(output).toContain(`"hero"`);
	});

	it('rejects a list key passed to `t`, and a text key passed to `t.array`', () => {
		const asText = check(`
			const t = await getTranslation('app', 'hero');
			t('bullets');
		`);
		const asList = check(`
			const t = await getTranslation('app', 'hero');
			t.array('title');
		`);

		expect(asText).toContain('TS2345');
		expect(asList).toContain('TS2345');
	});

	it('says so when a scope has no lists at all', () => {
		// `list: never` alone would produce a message about `never`, which is
		// accurate and tells the reader nothing.
		expect(
			check(`
				const t = await getTranslation('app', 'nav');
				t.array('settings');
			`),
		).toContain('this scope has no list keys');
	});

	it('lets `unknownKey` through, for a key built at runtime', () => {
		expect(
			check(`
				const code = String(404);
				const t = await getTranslation('app', 'hero');
				t(unknownKey('errors.' + code), {}, { fallback: 'Something went wrong' });
			`),
		).toBe('');
	});
});

describe('before any build has run', () => {
	// A project that installs the package and has not yet generated a registry
	// must still compile. Being wrong about a key is worth an error; being
	// unable to compile at all before the first build is not.
	it('accepts any namespace, scope and key', () => {
		expect(
			check(
				`
				const t = await getTranslation('whatever', 'any.scope');
				t('any.key');
				t.array('some.list');
				t.has('x');
				t.raw('y');
			`,
				{ withRegistry: false },
			),
		).toBe('');
	});
});

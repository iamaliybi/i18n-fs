/**
 * Plural, ordinal and select arguments, end to end.
 *
 * The core has its own tests for which arm a category selects. These cover the
 * half that only exists here: that `Intl.PluralRules` is consulted for the
 * right locale, that the categories reach the core, and — the one that matters
 * most — that `t` and `t.rich` render the same message the same way. `t`
 * chooses its arm in Rust and `t.rich` chooses one in TypeScript, so they are
 * two implementations of one rule and nothing but a test holds them together.
 */

// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadFullCore } from '../src/core/index.js';
import { createReporter } from '../src/report.js';
import { ErrorCode } from '../src/errors.js';
import { resetPluralCache } from '../src/plural.js';
import { createTranslator, type NamespaceState } from '../src/translator.js';

const core = await loadFullCore();

const MESSAGES = {
	files: '{count, plural, one {# file} other {# files}}',
	filesRu: '{count, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}',
	inbox: '{count, plural, =0 {Inbox is empty} one {# message} other {# messages}}',
	rank: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
	role: '{role, select, admin {Administrator} other {Member}}',
	rich: '{count, plural, one {# <b>file</b>} other {# <b>files</b>}}',
	incomplete: '{role, select, admin {Administrator}}',
	price: '{count, plural, other {# تومان}}',
};

function translator(locale: string) {
	const logged: string[] = [];
	const report = createReporter(true, (message) => logged.push(message));

	const state: NamespaceState = {
		status: 'ready',
		store: new core.Store(locale, 'home', JSON.stringify(MESSAGES)),
	};

	const t = createTranslator({
		core,
		locale,
		namespace: 'home',
		scope: undefined,
		state,
		report,
	});

	return { t, logged };
}

beforeEach(() => {
	resetPluralCache();
});

// vitest does not enable testing-library's automatic cleanup unless globals are
// on, and without it each render stacks up in the same document.
afterEach(cleanup);

/** The text a rich message renders to, with any markup stripped. */
function textOf(node: ReactNode): string {
	return render(<>{node}</>).container.textContent ?? '';
}

/** The markup a rich message renders to. */
function markupOf(node: ReactNode): string {
	return render(<>{node}</>).container.innerHTML;
}

describe('choosing an arm', () => {
	it('uses English rules for English', () => {
		const { t } = translator('en');

		expect(t('files', { count: 1 })).toBe('1 file');
		expect(t('files', { count: 5 })).toBe('5 files');
	});

	it('uses Russian rules for Russian, including 21 going back to the singular', () => {
		const { t } = translator('ru');

		expect(t('filesRu', { count: 1 })).toBe('1 файл');
		expect(t('filesRu', { count: 2 })).toBe('2 файла');
		expect(t('filesRu', { count: 5 })).toBe('5 файлов');
		// The case a hand-written `count === 1` gets wrong, in the language it
		// gets wrong for.
		expect(t('filesRu', { count: 21 })).toBe('21 файл');
	});

	it('reads the same message differently in two locales', () => {
		// `fa` counts 0 as singular and `en` does not. Same file, same key: the
		// only thing that differs is which rules the runtime applied.
		expect(translator('fa').t('files', { count: 0 })).toBe('۰ file');
		expect(translator('en').t('files', { count: 0 })).toBe('0 files');
	});

	it('lets an exact arm override the category', () => {
		const { t } = translator('en');

		expect(t('inbox', { count: 0 })).toBe('Inbox is empty');
		expect(t('inbox', { count: 1 })).toBe('1 message');
	});

	it('asks for ordinal categories where the message asks for ranks', () => {
		const { t } = translator('en');

		// 2 is `other` as a cardinal and `two` as an ordinal; reading the wrong
		// one produces "2th".
		expect(t('rank', { n: 1 })).toBe('1st');
		expect(t('rank', { n: 2 })).toBe('2nd');
		expect(t('rank', { n: 3 })).toBe('3rd');
		expect(t('rank', { n: 4 })).toBe('4th');
		expect(t('rank', { n: 21 })).toBe('21st');
	});

	it('matches a select argument on its value', () => {
		const { t } = translator('en');

		expect(t('role', { role: 'admin' })).toBe('Administrator');
		expect(t('role', { role: 'editor' })).toBe('Member');
	});

	it('accepts a number written as a string', () => {
		const { t } = translator('en');

		expect(t('files', { count: '5' })).toBe('5 files');
	});
});

describe('formatting the number', () => {
	it('writes # the way the locale writes numbers', () => {
		expect(translator('fa').t('price', { count: 1234 })).toBe('۱٬۲۳۴ تومان');
		expect(translator('en').t('files', { count: 1234 })).toBe('1,234 files');
	});
});

describe('what it reports', () => {
	it('distinguishes a missing argument from one that is not a number', () => {
		const missing = translator('en');
		expect(missing.t('files')).toBe('{count}');
		expect(missing.logged.join('\n')).toContain('PARAM_MISSING');

		const wrong = translator('en');
		// Renders through `other` rather than leaving a hole in the sentence,
		// and says exactly which of the two mistakes this was.
		expect(wrong.t('files', { count: 'many' })).toBe('# files');
		expect(wrong.logged.join('\n')).toContain('PLURAL_NOT_NUMERIC');
		expect(wrong.logged.join('\n')).not.toContain('PARAM_MISSING');
	});

	it('names the message that has no matching arm', () => {
		const { t, logged } = translator('en');

		expect(t('incomplete', { role: 'guest' })).toBe('{role}');
		expect(logged.join('\n')).toContain('NO_MATCHING_ARM');
		expect(logged.join('\n')).toContain('incomplete');
	});

	it('gives each of the three its own code', () => {
		expect(ErrorCode.ParamMissing).toBe(300);
		expect(ErrorCode.PluralNotNumeric).toBe(301);
		expect(ErrorCode.NoMatchingArm).toBe(302);
	});
});

describe('t.rich agrees with t', () => {
	// The guard against the two implementations drifting. `t` selects its arm
	// inside the WebAssembly core; `t.rich` selects one in `chooseArm` in
	// TypeScript, because a rich parameter may be a React element and cannot
	// cross the boundary. A message must not read differently depending on
	// which of the two rendered it.
	const cases: Array<[string, string, Record<string, string | number>]> = [
		['en', 'files', { count: 1 }],
		['en', 'files', { count: 9 }],
		['en', 'files', { count: 1234 }],
		['fa', 'files', { count: 0 }],
		['ru', 'filesRu', { count: 21 }],
		['ru', 'filesRu', { count: 5 }],
		['en', 'inbox', { count: 0 }],
		['en', 'inbox', { count: 3 }],
		['en', 'rank', { n: 2 }],
		['en', 'rank', { n: 21 }],
		['en', 'role', { role: 'admin' }],
		['en', 'role', { role: 'nobody' }],
		['en', 'incomplete', { role: 'guest' }],
		['en', 'files', { count: 'not a number' }],
		['fa', 'price', { count: 1234 }],
	];

	it.each(cases)('%s %s %o', (locale, key, params) => {
		const plain = translator(locale).t(key, params);
		const rich = translator(locale).t.rich(key, {}, params);

		expect(textOf(rich)).toBe(plain);
	});

	it('still renders tags inside an arm', () => {
		const { t } = translator('en');

		const rendered = t.rich('rich', { b: (chunk) => <strong>{chunk}</strong> }, { count: 3 });

		expect(markupOf(rendered)).toBe('3 <strong>files</strong>');
	});

	it('reports the same problems once', () => {
		const { t, logged } = translator('en');

		t.rich('files', {}, { count: 'many' });

		expect(logged.filter((line) => line.includes('PLURAL_NOT_NUMERIC'))).toHaveLength(1);
	});
});

describe('messages without plurals are untouched', () => {
	it('leaves a lone # alone', () => {
		const state: NamespaceState = {
			status: 'ready',
			store: new core.Store('en', 'home', JSON.stringify({ issue: 'see #42 about {topic}' })),
		};

		const t = createTranslator({
			core,
			locale: 'en',
			namespace: 'home',
			scope: undefined,
			state,
			report: createReporter(false, () => {}),
		});

		expect(t('issue', { topic: 'plurals' })).toBe('see #42 about plurals');
	});
});

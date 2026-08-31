/**
 * The formatters.
 *
 * These assert against real `Intl` output rather than mocking it, because the
 * value of this module is precisely that it is `Intl`: the Persian calendar,
 * the Persian digits and the Russian sorting are the runtime's, not ours, and a
 * test that stubbed them would be testing the stub.
 *
 * Exact strings are avoided where CLDR could reasonably revise them — the
 * separator between list items, the wording of "3 days ago". What is asserted
 * is the part that would be wrong if this module were wrong: which locale was
 * used, which calendar it resolved to, which unit was chosen, and which
 * direction the sign points.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createFormatter, resetFormatterCache } from '../src/formatter.js';

beforeEach(() => {
	resetFormatterCache();
});

const AUGUST = Date.UTC(2026, 7, 31, 9, 30);

describe('numbers', () => {
	it('writes digits and separators the way the locale does', () => {
		expect(createFormatter('en-US').number(1234567.89)).toBe('1,234,567.89');
		expect(createFormatter('fa-IR').number(1234567.89)).toBe('۱٬۲۳۴٬۵۶۷٫۸۹');
	});

	it('formats money and percentages', () => {
		const en = createFormatter('en-US');

		expect(en.number(1234.5, { style: 'currency', currency: 'USD' })).toBe('$1,234.50');
		expect(en.number(0.256, { style: 'percent', maximumFractionDigits: 1 })).toBe('25.6%');
	});

	it('passes every Intl option through', () => {
		expect(createFormatter('en-US').number(1200000, { notation: 'compact' })).toBe('1.2M');
	});
});

describe('dates', () => {
	it('resolves the Persian calendar for Persian without being asked', () => {
		// The reason this module can claim a Jalali date costs nothing: the
		// runtime already picks that calendar for `fa-IR`. No dependency, no
		// conversion table, no bytes.
		const formatted = createFormatter('fa-IR').dateTime(AUGUST, { dateStyle: 'full' });

		expect(formatted).toContain('۱۴۰۵');
		expect(formatted).not.toContain('2026');
	});

	it('formats the same instant differently per locale', () => {
		expect(createFormatter('en-US').dateTime(AUGUST, { dateStyle: 'full' })).toContain('2026');
	});

	it('accepts a Date as readily as a timestamp', () => {
		const one = createFormatter('en-US').dateTime(new Date(AUGUST), { dateStyle: 'short' });
		const two = createFormatter('en-US').dateTime(AUGUST, { dateStyle: 'short' });

		expect(one).toBe(two);
	});

	it('collapses what a range has in common', () => {
		const range = createFormatter('en-US').dateTimeRange(
			Date.UTC(2026, 7, 1),
			Date.UTC(2026, 7, 9),
			{ month: 'long', day: 'numeric', timeZone: 'UTC' },
		);

		// One month name, not two.
		expect(range.match(/August/g)).toHaveLength(1);
	});
});

describe('relative time', () => {
	const now = AUGUST;
	const format = () => createFormatter('en-US');

	it('picks a unit by size', () => {
		expect(format().relativeTime(now - 45_000, { now })).toContain('45 seconds');
		expect(format().relativeTime(now - 90 * 60_000, { now })).toContain('hour');
		expect(format().relativeTime(now - 3 * 86_400_000, { now })).toContain('3 days');
		expect(format().relativeTime(now - 400 * 86_400_000, { now })).toContain('year');
	});

	it('points forwards as readily as backwards', () => {
		expect(format().relativeTime(now + 2 * 3_600_000, { now })).toContain('in');
	});

	it('rounds towards zero, so nothing reads as further away than it is', () => {
		// 1.9 days is "1 day ago". Rounding to nearest would say 2, which is a
		// day that has not happened. Asserted with `numeric: 'always'` because
		// the default wording collapses it to "yesterday" and hides the number
		// this test is about.
		expect(format().relativeTime(now - 1.9 * 86_400_000, { now, numeric: 'always' })).toBe(
			'1 day ago',
		);
	});

	it('says yesterday rather than 1 day ago, unless asked otherwise', () => {
		expect(format().relativeTime(now - 86_400_000, { now })).toBe('yesterday');
		expect(format().relativeTime(now - 86_400_000, { now, numeric: 'always' })).toBe(
			'1 day ago',
		);
	});

	it('takes a forced unit', () => {
		expect(format().relativeTime(now - 3 * 86_400_000, { now, unit: 'hour' })).toContain('72');
	});

	it('is stable when given an explicit now', () => {
		// The reason `now` exists: a server render and a hydration happen at
		// different instants, and a timestamp that disagrees between them is a
		// React hydration error.
		const a = createFormatter('en-US').relativeTime(now - 60_000, { now });
		const b = createFormatter('en-US').relativeTime(now - 60_000, { now });

		expect(a).toBe(b);
	});
});

describe('lists and sorting', () => {
	it('joins a list the way the language joins one', () => {
		const joined = createFormatter('en-US').list(['a', 'b', 'c']);

		expect(joined).toBe('a, b, and c');
	});

	it('sorts by the language rather than by code point', () => {
		// German is the clearest demonstration: `ä` belongs beside `a`, and its
		// code point puts it after `z`. A first version of this test used a
		// Persian list whose collated order happens to equal its code-point
		// order, so it asserted nothing.
		const words = ['zebra', 'ärger', 'apfel'];

		expect([...words].sort(createFormatter('de').compare)).toEqual([
			'apfel',
			'ärger',
			'zebra',
		]);
		expect([...words].sort()).toEqual(['apfel', 'zebra', 'ärger']);
	});

	it('sorts Persian correctly too', () => {
		const format = createFormatter('fa');

		expect(['یونس', 'احمد', 'آرش'].sort(format.compare)).toEqual(['آرش', 'احمد', 'یونس']);
	});

	it('can be told to ignore case and accents', () => {
		const format = createFormatter('en');

		expect(format.compare('resume', 'résumé', { sensitivity: 'base' })).toBe(0);
		expect(format.compare('resume', 'résumé')).not.toBe(0);
	});
});

describe('caching', () => {
	it('reuses one Intl object per locale and options', () => {
		const format = createFormatter('en-US');

		// Not observable except through repetition being correct, which is the
		// point: the cache must not leak state between calls.
		const first = format.number(1000);
		const second = format.number(2000);
		const third = format.number(1000);

		expect(first).toBe('1,000');
		expect(second).toBe('2,000');
		expect(third).toBe(first);
	});

	it('does not confuse two option sets for one locale', () => {
		const format = createFormatter('en-US');

		expect(format.number(1234, { style: 'currency', currency: 'USD' })).toBe('$1,234.00');
		expect(format.number(1234)).toBe('1,234');
		expect(format.number(1234, { style: 'currency', currency: 'EUR' })).toBe('€1,234.00');
	});

	it('does not confuse two locales', () => {
		expect(createFormatter('en-US').number(1234)).toBe('1,234');
		expect(createFormatter('de-DE').number(1234)).toBe('1.234');
		expect(createFormatter('en-US').number(1234)).toBe('1,234');
	});
});

describe('the locale it was built for', () => {
	it('says so', () => {
		expect(createFormatter('fa-IR').locale).toBe('fa-IR');
	});
});

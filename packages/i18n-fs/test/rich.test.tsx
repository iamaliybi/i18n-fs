/**
 * `t.rich`.
 *
 * The thing worth testing here is that JSX never crosses the WASM boundary: the
 * core returns a node tree, and React elements are built on this side. That is
 * what allows a parameter to *be* an element rather than its stringification.
 */

// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFullCore } from '../src/core/index.js';
import { createReporter } from '../src/report.js';
import { createTranslator, type NamespaceState } from '../src/translator.js';

const core = await loadFullCore();

// vitest does not enable testing-library's automatic cleanup unless globals are
// on, and without it each render stacks up in the same document.
afterEach(cleanup);

const MESSAGES = JSON.stringify({
	plain: 'Nothing special here',
	terms: 'Read the <link>terms</link> before you <b>continue</b>',
	nested: '<b>bold <i>and italic</i></b>',
	same: '<b>outer <b>inner</b> outer</b>',
	withParam: 'Hello <b>{name}</b>',
	unknownTag: 'An <unhandled>region</unhandled> here',
});

function translator(raw = MESSAGES) {
	const logged: string[] = [];
	const state: NamespaceState = {
		status: 'ready',
		store: new core.Store('fa', 'home', raw),
	};

	return {
		t: createTranslator({
			core,
			locale: 'fa',
			namespace: 'home',
			state,
			report: createReporter(true, (message) => logged.push(message)),
		}),
		logged,
	};
}

describe('rich messages', () => {
	it('returns a plain string when there is no markup', () => {
		const { t } = translator();
		expect(t.rich('plain')).toBe('Nothing special here');
	});

	it('renders each tag with the caller function', () => {
		const { t } = translator();

		render(
			<p>
				{t.rich('terms', {
					link: (chunk) => <a href="/terms">{chunk}</a>,
					b: (chunk) => <strong>{chunk}</strong>,
				})}
			</p>,
		);

		expect(screen.getByRole('link', { name: 'terms' })).toHaveProperty('href');
		expect(screen.getByText('continue').tagName).toBe('STRONG');
	});

	it('renders nested tags', () => {
		const { t } = translator();

		const { container } = render(
			<p>
				{t.rich('nested', {
					b: (chunk) => <strong>{chunk}</strong>,
					i: (chunk) => <em>{chunk}</em>,
				})}
			</p>,
		);

		expect(container.querySelector('strong em')?.textContent).toBe('and italic');
	});

	it('renders a tag nested inside one of the same name', () => {
		// The regex parser this replaced closed the outer tag at the inner
		// closing tag and dropped the rest.
		const { t } = translator();

		const { container } = render(
			<p>{t.rich('same', { b: (chunk) => <strong>{chunk}</strong> })}</p>,
		);

		expect(container.querySelector('strong strong')?.textContent).toBe('inner');
		expect(container.textContent).toBe('outer inner outer');
	});

	it('accepts a React element as a parameter', () => {
		// Only possible because substitution happens after tokenising, on this
		// side of the boundary. Interpolating first would stringify the element
		// to "[object Object]".
		//
		// This test used to pass the string 'Ali' while claiming to cover an
		// element, and the public type only allowed `string | number` — so the
		// documented behaviour was neither typed nor tested, and worked by
		// accident.
		const { t } = translator();

		const { container } = render(
			<p>
				{t.rich(
					'withParam',
					{ b: (chunk) => <strong>{chunk}</strong> },
					{ name: <em data-testid="element-param">Ali</em> },
				)}
			</p>,
		);

		expect(container.querySelector('em')?.textContent).toBe('Ali');
		expect(container.querySelector('strong em')).not.toBeNull();
	});

	it('leaves an unhandled tag visible rather than dropping its content', () => {
		const { t } = translator();
		const { container } = render(<p>{t.rich('unknownTag')}</p>);

		expect(container.textContent).toContain('region');
	});

	it('falls back like every other lookup', () => {
		const { t, logged } = translator();

		expect(t.rich('nope')).toBe('nope');
		expect(t.rich('nope', {}, {}, { fallback: 'Nothing' })).toBe('Nothing');
		expect(logged[0]).toContain('KEY_NOT_FOUND');
	});

	it('reports a missing parameter and keeps the marker', () => {
		const { t, logged } = translator();
		const { container } = render(
			<p>{t.rich('withParam', { b: (chunk) => <strong>{chunk}</strong> })}</p>,
		);

		expect(container.textContent).toBe('Hello {name}');
		expect(logged[0]).toContain('PARAM_MISSING');
	});

	it('renders without React key warnings', () => {
		// Tag output goes into an array, so every branch has to carry a key.
		const errors: unknown[] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => errors.push(args[0]);

		try {
			const { t } = translator();
			render(
				<p>
					{t.rich('terms', {
						link: (chunk) => <a href="/terms">{chunk}</a>,
						b: (chunk) => <strong>{chunk}</strong>,
					})}
				</p>,
			);
		} finally {
			console.error = original;
		}

		expect(errors.filter((e) => String(e).includes('unique "key"'))).toEqual([]);
	});
});

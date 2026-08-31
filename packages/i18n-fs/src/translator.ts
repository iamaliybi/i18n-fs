/**
 * The `t` function.
 *
 * Deliberately framework-agnostic and synchronous: it is handed an already
 * loaded namespace and does no I/O. The server layer and the client hook differ
 * only in how they obtain that namespace, so they share this file and cannot drift
 * apart in how a lookup behaves or how a failure is reported.
 */

import { createElement, Fragment, type ReactNode } from 'react';
import type {
	I18nErrorPayload,
	MessageArm,
	MessageCore,
	MessageNode,
	Store,
} from './core/types.js';
import { pluralArgs, type PluralArg } from './plural.js';
import type { Reporter } from './report.js';
import type { AnyKey, ListKey, ScopeShape, TextKey } from './registry.js';
import { ErrorCode } from './errors.js';

/** Values substituted into `{placeholder}` markers. */
export type TranslationParams = Record<string, string | number>;

/**
 * Parameters for `t.rich`, which may also be React elements.
 *
 * `t` and `t.array` produce strings and can only substitute strings. `t.rich`
 * builds React output, and substitution happens *after* the message is
 * tokenised — so an element passed here stays an element instead of being
 * stringified to `[object Object]` on the way in.
 */
export type RichTranslationParams = Record<string, ReactNode | string | number>;

/** Renderers for `<tag>` regions in a rich message. */
export type TagRenderers = Record<string, (chunk: ReactNode) => ReactNode>;

/** Per-call overrides. */
export interface TranslateOptions {
	/**
	 * Shown instead of the key when the lookup fails.
	 *
	 * This is the only fallback there is. `i18n-fs` never substitutes another
	 * locale's content.
	 */
	fallback?: string;
}

/** A loaded namespace, or the reason it could not be loaded. */
export type NamespaceState =
	| { readonly status: 'ready'; readonly store: Store }
	| { readonly status: 'failed'; readonly error: I18nErrorPayload };

/**
 * What `useTranslation` and `getTranslation` return.
 *
 * Generic over the scope it was built for, so the keys it accepts are the keys
 * that scope actually has. The parameter defaults to "anything", which is what
 * a project gets before `i18n-fs build` has written the registry — and what
 * `Translator` means when written without arguments, so existing annotations
 * keep working.
 */
export interface Translator<Shape extends ScopeShape = ScopeShape> {
	/** A single message. */
	(key: TextKey<Shape>, params?: TranslationParams, options?: TranslateOptions): string;
	/** A message with `<tag>` regions rendered by the caller. */
	rich(
		key: TextKey<Shape>,
		tags?: TagRenderers,
		params?: RichTranslationParams,
		options?: TranslateOptions,
	): ReactNode;
	/** A list of messages. */
	array(
		key: ListKey<Shape>,
		params?: TranslationParams,
		options?: TranslateOptions,
	): string[];
	/** Whether the key resolves to a message or a list. */
	has(key: AnyKey<Shape>): boolean;
	/** The stored value with no interpolation, or `undefined` if absent. */
	raw(key: AnyKey<Shape>): string | string[] | undefined;
}

/** Everything the translator needs, supplied by whichever layer built it. */
export interface TranslatorContext {
	core: MessageCore;
	locale: string;
	namespace: string;
	scope?: string | undefined;
	state: NamespaceState;
	report: Reporter;
}

function stringifyParams(params?: TranslationParams): Record<string, string> {
	if (!params) return {};

	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(params)) {
		out[name] = typeof value === 'string' ? value : String(value);
	}
	return out;
}

function isErrorPayload(value: unknown): value is I18nErrorPayload {
	return typeof value === 'object' && value !== null && 'code' in value;
}

/**
 * Build the `t` function for one namespace and scope.
 *
 * Every path through here ends in either a resolved message or
 * `options.fallback ?? key`, and every failure is reported with its own code.
 */
export function createTranslator(context: TranslatorContext): Translator {
	const { core, locale, namespace, scope, state, report } = context;

	const fail = (key: string, options?: TranslateOptions): string => options?.fallback ?? key;

	/** Report whatever went wrong, normalising errors thrown across the WASM boundary. */
	const reportFailure = (error: unknown, key: string): void => {
		if (isErrorPayload(error)) {
			report(error);
			return;
		}

		report({
			code: ErrorCode.KeyNotFound,
			locale,
			namespace,
			scope: scope ?? null,
			key,
			detail: error instanceof Error ? error.message : String(error),
		});
	};

	/** The namespace, or `undefined` after reporting why it is unavailable. */
	const store = (key: string): Store | undefined => {
		if (state.status === 'ready') return state.store;

		// The load failure is reported against the key that asked for it, so the
		// message names a call site the developer can find.
		report({ ...state.error, key: state.error.key ?? key });
		return undefined;
	};

	const resolveText = (key: string): string | undefined => {
		const loaded = store(key);
		if (!loaded) return undefined;

		try {
			return loaded.resolveText(scope, key);
		} catch (error) {
			reportFailure(error, key);
			return undefined;
		}
	};

	/** Report one argument against the code that describes what went wrong. */
	const complain = (code: ErrorCode, key: string, detail: string): void => {
		report({
			code,
			locale,
			namespace,
			scope: scope ?? null,
			key,
			detail,
		});
	};

	const interpolate = (
		template: string,
		key: string,
		params?: TranslationParams,
	): string => {
		const result = core.interpolate(
			template,
			stringifyParams(params),
			pluralArgs(locale, params),
		);

		for (const name of result.missing) {
			complain(ErrorCode.ParamMissing, key, `no value supplied for {${name}}`);
		}

		// Kept apart from `missing` on purpose: "you forgot to pass count" and
		// "you passed count, but it was a word" are different mistakes with
		// different fixes, and a single code would have made the caller guess.
		for (const name of result.notNumeric) {
			complain(
				ErrorCode.PluralNotNumeric,
				key,
				`{${name}} is used as a plural argument but was not given a number`,
			);
		}

		for (const name of result.unmatched) {
			complain(
				ErrorCode.NoMatchingArm,
				key,
				`{${name}} matched none of its arms and the message has no "other"`,
			);
		}

		return result.value;
	};

	const t = ((key, params, options) => {
		const template = resolveText(key);
		if (template === undefined) return fail(key, options);

		return interpolate(template, key, params);
	}) as Translator;

	t.rich = (key, tags, params, options) => {
		const template = resolveText(key);
		if (template === undefined) return fail(key, options);

		// Reported once each, matching what the core does for `t`. A message
		// may use the same argument twice, and two identical diagnostics for
		// one mistake reads as two mistakes.
		const seen = new Set<string>();
		const once = (code: ErrorCode, name: string, detail: string): void => {
			if (seen.has(`${code}:${name}`)) return;
			seen.add(`${code}:${name}`);
			complain(code, key, detail);
		};

		// Parameters are not substituted before tokenising: a rich parameter may
		// be a React element, and splicing one into a string would stringify it.
		return renderNodes(core.tokenize(template), {
			tags: tags ?? {},
			params: params ?? {},
			plurals: pluralArgs(locale, params),
			onMissingParam: (name) =>
				once(ErrorCode.ParamMissing, name, `no value supplied for {${name}}`),
			onNotNumeric: (name) =>
				once(
					ErrorCode.PluralNotNumeric,
					name,
					`{${name}} is used as a plural argument but was not given a number`,
				),
			onUnmatched: (name) =>
				once(
					ErrorCode.NoMatchingArm,
					name,
					`{${name}} matched none of its arms and the message has no "other"`,
				),
		});
	};

	t.array = (key, params, options) => {
		const loaded = store(key);
		if (!loaded) return [fail(key, options)];

		try {
			return loaded
				.resolveList(scope, key)
				.map((entry) => interpolate(entry, key, params));
		} catch (error) {
			reportFailure(error, key);
			return [fail(key, options)];
		}
	};

	t.has = (key) => (state.status === 'ready' ? state.store.has(scope, key) : false);

	t.raw = (key) => {
		if (state.status !== 'ready') return undefined;

		try {
			return state.store.resolveAny(scope, key);
		} catch {
			// `raw` is the escape hatch for callers doing their own handling, so it
			// answers "is there a value" without also logging.
			return undefined;
		}
	};

	return t;
}

interface RenderContext {
	tags: TagRenderers;
	params: Record<string, ReactNode | string | number>;
	plurals: Record<string, PluralArg> | undefined;
	/** The enclosing plural argument's formatted value, which `#` renders as. */
	sharp?: string | undefined;
	onMissingParam: (name: string) => void;
	onNotNumeric: (name: string) => void;
	onUnmatched: (name: string) => void;
}

/**
 * Whether two written numbers are the same number, for `=0` arms.
 *
 * The mirror of `same_number` in the core. It has to be: `t` selects an arm in
 * Rust and `t.rich` selects one here, and a message must not read differently
 * depending on which one rendered it. `rich-agrees-with-t` in the tests is what
 * holds the two together.
 */
function sameNumber(left: string, right: string): boolean {
	const a = Number(left);
	const b = Number(right);

	if (Number.isFinite(a) && Number.isFinite(b)) return a === b;
	return left === right;
}

/**
 * Which arm an argument selects, or `undefined` when nothing matched and there
 * is no `other`.
 *
 * `=0` and friends are tried first and beat the category, so "no items at all"
 * can be written without disturbing the grammatical arms around it.
 */
function chooseArm(
	node: Extract<MessageNode, { type: 'plural' | 'select' }>,
	value: string,
	category: string | undefined,
): MessageArm | undefined {
	for (const arm of node.arms) {
		if (arm.key.startsWith('=') && sameNumber(arm.key.slice(1), value)) return arm;
	}

	const wanted = node.type === 'select' ? value : category;

	if (wanted !== undefined) {
		const matched = node.arms.find((arm) => arm.key === wanted);
		if (matched) return matched;
	}

	return node.arms.find((arm) => arm.key === 'other');
}

/** The plain-text form of a parameter, for choosing an arm. */
function selectorFor(value: ReactNode | string | number): string | undefined {
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);

	// A React element can be interpolated into a message but cannot choose one
	// of its arms, so it is treated as absent rather than stringified into
	// something that would match nothing.
	return undefined;
}

/**
 * Turn the core's node tree into React output.
 *
 * The tree is balanced by construction, so this needs no error handling for
 * malformed markup — the tokeniser already degraded it to text.
 */
function renderNodes(nodes: MessageNode[], context: RenderContext): ReactNode {
	const rendered = nodes.map((node, index) => renderNode(node, context, index));

	// A message that is nothing but text stays a string, so `t.rich` on a plain
	// message behaves like `t` rather than wrapping it in an array of one.
	if (rendered.length === 1 && typeof rendered[0] === 'string') return rendered[0];
	if (rendered.every((child) => typeof child === 'string')) return rendered.join('');

	return rendered;
}

function renderNode(node: MessageNode, context: RenderContext, index: number): ReactNode {
	switch (node.type) {
		case 'text':
			return node.value;

		case 'param': {
			const value = context.params[node.name];
			if (value === undefined) {
				context.onMissingParam(node.name);
				// The marker stays visible, matching `interpolate`.
				return `{${node.name}}`;
			}
			return typeof value === 'number' ? String(value) : value;
		}

		case 'tag': {
			const render = context.tags[node.name];
			const children = renderNodes(node.children, context);

			if (!render) {
				// An unhandled tag is left as literal markup rather than dropped, so
				// the gap is visible to whoever wrote the message.
				return `<${node.name}>${typeof children === 'string' ? children : ''}</${node.name}>`;
			}

			// Rendered children go into an array, so React wants a key. The
			// renderer belongs to the caller, so a keyed Fragment supplies one
			// without touching whatever they returned.
			return createElement(Fragment, { key: index }, render(children));
		}

		case 'number':
			// Only reachable inside a plural arm, where the core set `sharp`.
			return context.sharp ?? '#';

		case 'plural':
		case 'select': {
			const raw = context.params[node.name];
			const value = raw === undefined ? undefined : selectorFor(raw);

			if (value === undefined) {
				// Same treatment as a bare placeholder with no value: rendering
				// `other` instead would print "# files" with no number in it.
				context.onMissingParam(node.name);
				return `{${node.name}}`;
			}

			const plural = node.type === 'plural' ? context.plurals?.[node.name] : undefined;
			if (node.type === 'plural' && !plural) context.onNotNumeric(node.name);

			const category = plural
				? node.type === 'plural' && node.ordinal
					? plural.ordinal
					: plural.cardinal
				: undefined;
			const arm = chooseArm(node, value, category);

			if (!arm) {
				context.onUnmatched(node.name);
				return `{${node.name}}`;
			}

			return renderNodes(arm.children, { ...context, sharp: plural?.formatted });
		}
	}
}

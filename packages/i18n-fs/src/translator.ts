/**
 * The `t` function.
 *
 * Deliberately framework-agnostic and synchronous: it is handed an already
 * loaded namespace and does no I/O. The server layer and the client hook differ
 * only in how they obtain that namespace, so they share this file and cannot drift
 * apart in how a lookup behaves or how a failure is reported.
 */

import { createElement, Fragment, type ReactNode } from 'react';
import type { I18nErrorPayload, MessageCore, MessageNode, Store } from './core/types.js';
import type { Reporter } from './report.js';
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

/** What `useTranslation` and `getTranslation` return. */
export interface Translator {
	/** A single message. */
	(key: string, params?: TranslationParams, options?: TranslateOptions): string;
	/** A message with `<tag>` regions rendered by the caller. */
	rich(
		key: string,
		tags?: TagRenderers,
		params?: RichTranslationParams,
		options?: TranslateOptions,
	): ReactNode;
	/** A list of messages. */
	array(key: string, params?: TranslationParams, options?: TranslateOptions): string[];
	/** Whether the key resolves to a message or a list. */
	has(key: string): boolean;
	/** The stored value with no interpolation, or `undefined` if absent. */
	raw(key: string): string | string[] | undefined;
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

	const interpolate = (
		template: string,
		key: string,
		params?: TranslationParams,
	): string => {
		const result = core.interpolate(template, stringifyParams(params));

		for (const name of result.missing) {
			report({
				code: ErrorCode.ParamMissing,
				locale,
				namespace,
				scope: scope ?? null,
				key,
				detail: `no value supplied for {${name}}`,
			});
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

		// Parameters are not substituted before tokenising: a rich parameter may
		// be a React element, and splicing one into a string would stringify it.
		return renderNodes(core.tokenize(template), {
			tags: tags ?? {},
			params: params ?? {},
			onMissingParam: (name) =>
				report({
					code: ErrorCode.ParamMissing,
					locale,
					namespace,
					scope: scope ?? null,
					key,
					detail: `no value supplied for {${name}}`,
				}),
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
	onMissingParam: (name: string) => void;
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
	}
}

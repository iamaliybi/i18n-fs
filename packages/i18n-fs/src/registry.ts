/**
 * The bridge between the generated key list and the functions you call.
 *
 * `i18n-fs build` writes `.i18n-fs/messages.d.ts`, which augments
 * `MessageRegistry` with every namespace, the scopes inside it, and which keys
 * are text and which are lists. That file described your messages accurately
 * and nothing read it: `getTranslation` took a `string` and `t` took a `string`,
 * so a mistyped key compiled and the README's claim that "a renamed key is a
 * compile error" was not true. This is where the two are connected.
 *
 * Everything degrades to `string` when the registry is empty, which is the state
 * of any project that has not run `i18n-fs build` yet — and of this package's
 * own tests. Being wrong about a key is worth a compile error; being unable to
 * compile at all before the first build is not.
 */

/**
 * Every namespace and its keys. Empty here, filled in by the generated file.
 *
 * ```ts
 * interface MessageRegistry {
 *   'home/hero': {
 *     '': { text: 'hero.title' | 'terms'; list: 'hero.bullets' };
 *     'hero': { text: 'title'; list: 'bullets' };
 *   };
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MessageRegistry {}

/** Whether `i18n-fs build` has contributed anything to the registry. */
type Generated = [keyof MessageRegistry] extends [never] ? false : true;

/** What one scope holds: the keys reachable from it, split by shape. */
export interface ScopeShape {
	text: string;
	list: string;
}

/** A namespace name — checked once the registry exists, any string before. */
export type NamespaceName = Generated extends true ? keyof MessageRegistry & string : string;

/**
 * The scopes inside a namespace.
 *
 * The root scope is the empty string, which is what `getTranslation(ns)` uses
 * when no scope is given.
 */
export type ScopeName<N extends NamespaceName> = Generated extends true
	? N extends keyof MessageRegistry
		? keyof MessageRegistry[N] & string
		: string
	: string;

/** The shape of one scope: its text keys and its list keys. */
export type ShapeOf<N extends NamespaceName, S extends ScopeName<N>> = Generated extends true
	? N extends keyof MessageRegistry
		? S extends keyof MessageRegistry[N]
			? MessageRegistry[N][S] extends ScopeShape
				? MessageRegistry[N][S]
				: ScopeShape
			: ScopeShape
		: ScopeShape
	: ScopeShape;

/**
 * A key of the given shape, widened to `string` when nothing is known.
 *
 * A scope with no lists generates `list: never`, and `never` would make
 * `t.array` reject every argument with a message about `never` — which is
 * correct and unreadable. It reads as "this scope has no lists" instead.
 */
export type TextKey<S extends ScopeShape> = [S['text']] extends [never] ? string : S['text'];

/** A list key, or a hint when the scope has none. */
export type ListKey<S extends ScopeShape> = [S['list']] extends [never]
	? 'this scope has no list keys'
	: S['list'];

/** Any key of the scope, whatever its shape. */
export type AnyKey<S extends ScopeShape> = [S['text'] | S['list']] extends [never]
	? string
	: S['text'] | S['list'];

/**
 * A key the registry does not know about.
 *
 * There are two honest reasons to need one. A key can be assembled at runtime —
 * `t(unknownKey(`errors.${code}`))` — and a union cannot describe that. And a
 * key can be deliberately absent, to demonstrate that a missing message renders
 * its fallback rather than breaking the page.
 *
 * ```ts
 * t(unknownKey(`errors.${code}`), {}, { fallback: 'Something went wrong' });
 * ```
 *
 * A function rather than a bare `as never` cast, because the intent is then
 * visible in a diff and greppable across a codebase. It does nothing at
 * runtime: the key is passed through, and a key that turns out not to exist
 * degrades exactly as any other missing key does.
 */
export function unknownKey(key: string): never {
	return key as never;
}

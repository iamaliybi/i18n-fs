/**
 * The error taxonomy, as values you can import.
 *
 * ```ts
 * import { ErrorCode } from 'i18n-fs';
 *
 * try {
 *   store.resolveText('hero', 'title');
 * } catch (error) {
 *   if (error.code === ErrorCode.KeyNotFound) { … }
 * }
 * ```
 *
 * Codes are numbers rather than strings so a comparison cannot fail on a typo,
 * and they are grouped so a whole class of problem is one comparison away:
 *
 * | range  | meaning                                            |
 * | ------ | -------------------------------------------------- |
 * | `1xx`  | the namespace could not be used at all             |
 * | `2xx`  | the namespace is fine; the lookup inside it is not |
 * | `3xx`  | the message resolved; formatting it went wrong     |
 * | `4xx`  | the configuration is wrong                         |
 *
 * The values are a public contract, and match `i18n_fs_core::ErrorCode` exactly.
 * New codes may be added; existing ones are never renumbered.
 */

/** Why a lookup failed. */
export const ErrorCode = Object.freeze({
	/** The namespace file could not be loaded — missing file, 404, unreadable. */
	NamespaceNotFound: 100,
	/** The namespace file was loaded but is not valid JSON. */
	InvalidJson: 101,
	/** The file parsed, but the requested scope object is absent. */
	ScopeNotFound: 200,
	/** The scope exists; the key inside it does not. */
	KeyNotFound: 201,
	/** The key exists but holds the wrong shape — an object where a string was
	 * asked for, or a string where `t.array` expected a list. */
	TypeMismatch: 202,
	/** A `{placeholder}` had no matching entry in `params`. */
	ParamMissing: 300,
	/** The configuration is not internally consistent. */
	InvalidConfig: 400,
} as const);

/** Why a lookup failed. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The name of each code, for logs and messages. */
export const ERROR_CODE_NAMES: Readonly<Record<ErrorCode, string>> = Object.freeze({
	[ErrorCode.NamespaceNotFound]: 'NAMESPACE_NOT_FOUND',
	[ErrorCode.InvalidJson]: 'INVALID_JSON',
	[ErrorCode.ScopeNotFound]: 'SCOPE_NOT_FOUND',
	[ErrorCode.KeyNotFound]: 'KEY_NOT_FOUND',
	[ErrorCode.TypeMismatch]: 'TYPE_MISMATCH',
	[ErrorCode.ParamMissing]: 'PARAM_MISSING',
	[ErrorCode.InvalidConfig]: 'INVALID_CONFIG',
});

/**
 * The name of a code, or `UNKNOWN_<n>` for one this version does not know.
 *
 * A number alone is not much use in a console, so every diagnostic prints the
 * name beside it.
 */
export function errorCodeName(code: number): string {
	return ERROR_CODE_NAMES[code as ErrorCode] ?? `UNKNOWN_${code}`;
}

/** Whether `code` is one this version of the package knows about. */
export function isErrorCode(code: unknown): code is ErrorCode {
	return typeof code === 'number' && code in ERROR_CODE_NAMES;
}

/**
 * Whether the namespace itself could not be used, as opposed to the lookup
 * inside it — the `1xx` group.
 *
 * The distinction is worth acting on: a missing file is one problem to fix,
 * where a missing key is one problem per key.
 */
export function isNamespaceError(code: number): boolean {
	return code >= 100 && code < 200;
}

/** Whether the file was fine but the lookup inside it was not — the `2xx` group. */
export function isLookupError(code: number): boolean {
	return code >= 200 && code < 300;
}

/**
 * The package version, injected at build time.
 *
 * Read from `package.json` by tsup's `define`, and by vitest's, so tests see
 * the same value the build produces. Importing `package.json` instead would
 * inline the whole manifest into every entry point for the sake of one string.
 */
declare const __I18N_FS_VERSION__: string;

/** Version of `i18n-fs`. */
export const VERSION: string =
	typeof __I18N_FS_VERSION__ === 'string' ? __I18N_FS_VERSION__ : '0.0.0-unbuilt';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
	// Mirrors tsup, so a test sees the version a build would produce rather than
	// the unbuilt placeholder.
	define: { __I18N_FS_VERSION__: JSON.stringify(version) },
	resolve: {
		alias: {
			// `package.json#imports` points at `dist`, which is correct for
			// consumers but not for a test run against source. Tests execute in
			// Node, so they get the Node bindings.
			'#core-bindings': fileURLToPath(new URL('./src/core/bindings.node.ts', import.meta.url)),
			// The provider self-references this so the 'use client' boundary stays a
			// real module. Without the alias the tests would load it from dist and
			// end up with a second React context, distinct from the one they import.
			'i18n-fs/client': fileURLToPath(new URL('./src/client/index.ts', import.meta.url)),
		},
	},
	test: {
		// The smoke test loads the real Node WASM build.
		environment: 'node',
		include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
	},
});

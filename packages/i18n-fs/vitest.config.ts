import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			// `package.json#imports` points at `dist`, which is correct for
			// consumers but not for a test run against source. Tests execute in
			// Node, so they get the Node bindings.
			'#core-bindings': fileURLToPath(new URL('./src/core/bindings.node.ts', import.meta.url)),
		},
	},
	test: {
		// The smoke test loads the real Node WASM build.
		environment: 'node',
		include: ['test/**/*.test.ts'],
	},
});

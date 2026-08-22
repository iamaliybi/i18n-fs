import { defineConfig } from 'tsup';

export default defineConfig({
	entry: [
		'src/index.ts',
		'src/config.ts',
		// Emitted as separate chunks because `package.json#imports` resolves one
		// of them per runtime. Bundling them together would ship the browser and
		// Node loaders into the Edge bundle.
		'src/core/bindings.edge.ts',
		'src/core/bindings.browser.ts',
		'src/core/bindings.node.ts',
		'src/cli/main.ts',
	],
	format: ['esm'],
	dts: true,
	clean: true,
	sourcemap: true,
	splitting: false,
	treeshake: true,
	external: [
		// Resolved at runtime through `package.json#imports`, so it must survive
		// bundling as a bare specifier.
		'#core-bindings',
		// The wasm-pack output ships as files and is loaded at runtime. Bundling
		// it would inline all three binaries into every entry point. The relative
		// path is the same from `src/core` and `dist/core`, so it survives the
		// move into `dist` unchanged.
		/^\.\.\/\.\.\/wasm\//,
	],
});

import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

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
		'src/server/index.ts',
		'src/client/index.ts',
		'src/navigation.ts',
		'src/middleware.ts',
		'src/proxy.ts',
	],
	// One string, not the whole manifest: importing package.json would inline it
	// into every entry point.
	define: { __I18N_FS_VERSION__: JSON.stringify(version) },
	format: ['esm'],
	dts: true,
	clean: true,
	sourcemap: true,
	splitting: false,
	treeshake: true,
	external: [
		// Provided by the application, not bundled.
		'react',
		'react-dom',
		'next',
		/^next\//,
		// Resolved at runtime through `package.json#imports`, so it must survive
		// bundling as a bare specifier.
		'#core-bindings',
		// Self-referenced by the server provider so the 'use client' boundary
		// survives as a real module instead of being inlined into the server chunk.
		'i18n-fs/client',
		// The wasm-pack output ships as files and is loaded at runtime. Bundling
		// it would inline all three binaries into every entry point. The relative
		// path is the same from `src/core` and `dist/core`, so it survives the
		// move into `dist` unchanged.
		/^\.\.\/\.\.\/wasm\//,
	],
});

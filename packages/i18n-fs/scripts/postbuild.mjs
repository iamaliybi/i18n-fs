// Restores the two things bundlers strip but Node and Next.js need.
//
//   * The CLI's shebang. It cannot live in the TypeScript source —
//     `#!/usr/bin/env node` is a syntax error there — and tsup's banner option
//     applies to every entry, which would put it in the library files too.
//
//   * The `'use client'` directive. esbuild drops module-level directives when
//     bundling ("Module level directives cause errors when bundled"), and
//     without it Next.js treats the client entry as a Server Component and the
//     hooks inside it fail at render time.

import { chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/** Prepend `prefix` to `file` unless it already starts with `marker`. */
async function prepend(file, prefix, marker) {
	const path = join(dist, file);
	const contents = await readFile(path, 'utf8');

	if (contents.startsWith(marker)) return false;

	await writeFile(path, prefix + contents, 'utf8');
	return true;
}

await prepend(join('cli', 'main.js'), '#!/usr/bin/env node\n', '#!');
await prepend(join('client', 'index.js'), "'use client';\n", "'use client'");

// No-op on Windows, which is where this most often runs during development.
await chmod(join(dist, 'cli', 'main.js'), 0o755);

console.log('postbuild: shebang and "use client" restored');

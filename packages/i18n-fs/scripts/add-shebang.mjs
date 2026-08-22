// Makes the built CLI executable.
//
// The shebang cannot live in the TypeScript source — `#!/usr/bin/env node` is a
// syntax error there — and tsup's banner option applies to every entry, which
// would put it in the library files too. So it is prepended afterwards, to the
// one file that needs it.

import { chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	join('dist', 'cli', 'main.js'),
);

const SHEBANG = '#!/usr/bin/env node\n';
const contents = await readFile(target, 'utf8');

if (!contents.startsWith('#!')) {
	await writeFile(target, SHEBANG + contents, 'utf8');
}

// No-op on Windows, which is where this most often runs during development.
await chmod(target, 0o755);

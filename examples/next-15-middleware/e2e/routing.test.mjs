/**
 * Next.js 15 with the `middleware` file convention.
 *
 * The assertions live in `examples/shared/routing-suite.mjs`, so this app and
 * the Next.js 16 one are held to exactly the same contract. That is the point
 * of having both: the same behaviour across two Next.js majors and two file
 * conventions, proven rather than assumed.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeRouting } from '../../shared/routing-suite.mjs';

describeRouting({
	root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
	// A port of its own, so both examples can run at once.
	port: Number(process.env.E2E_PORT ?? 3124),
	label: 'next 15 / middleware.ts',
});

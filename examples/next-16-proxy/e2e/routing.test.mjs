/**
 * Next.js 16 with the `proxy` file convention.
 *
 * The assertions live in `examples/shared/routing-suite.mjs`, so this app and
 * the Next.js 15 one are held to exactly the same contract. That is the point
 * of having both.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeRouting } from '../../shared/routing-suite.mjs';

describeRouting({
	root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
	port: Number(process.env.E2E_PORT ?? 3123),
	label: 'next 16 / proxy.ts',
});

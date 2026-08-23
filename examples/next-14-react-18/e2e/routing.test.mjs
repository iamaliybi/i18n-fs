/**
 * Next.js 14.2 with React 18 — the floor of the supported range.
 *
 * `peerDependencies` allows `next@^14.2` and `react@^18.3`, and until now
 * nothing tested either. That matters more than it looks: `useTranslation`
 * calls React's `use()`, which is not in the React 18 release. It works here
 * because the App Router does not run the React in your `package.json` — Next
 * vendors its own build, and Next 14.2 vendors an 18.3 canary that has `use()`.
 *
 * So this app is not "one more example". It is the test of a claim the manifest
 * makes and the other two examples cannot check, both being on React 19.
 *
 * The assertions come from `examples/shared`, unchanged, so the three apps are
 * held to exactly the same contract.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeRouting } from '../../shared/routing-suite.mjs';

describeRouting({
	root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
	// A port of its own, so all three examples can run at once.
	port: Number(process.env.E2E_PORT ?? 3125),
	label: 'next 14 / react 18',
});

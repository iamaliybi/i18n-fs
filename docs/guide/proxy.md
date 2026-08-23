# The proxy (middleware)

Next.js 16 renamed this file convention from `middleware` to `proxy` and
deprecated the old name. Both work; the handler is identical either way, because
what changed is the filename Next.js looks for, not the signature it expects.

## Next.js 16 and later

```ts
// proxy.ts
import { createI18nProxy } from 'i18n-fs/proxy';
import i18nConfig from './.i18n-fs/config.mjs';

export default createI18nProxy(i18nConfig);

export const config = {
	matcher: ['/((?!_next/|api/|.*\\.[^/]*$).*)'],
};
```

## Next.js 14 and 15

```ts
// middleware.ts
import { createI18nMiddleware } from 'i18n-fs/middleware';
import i18nConfig from './.i18n-fs/config.mjs';

export default createI18nMiddleware(i18nConfig);

export const config = {
	matcher: ['/((?!_next/|api/|.*\\.[^/]*$).*)'],
};
```

`createI18nMiddleware` is the same function under its older name. Both entry
points export both names, so you can rename the file and the import
independently.

Next.js provides a codemod:

```bash
npx @next/codemod@canary middleware-to-proxy .
```

Having both `middleware.ts` and `proxy.ts` is an error — Next.js will tell you
to keep only the proxy.

## No `next.config` changes

None are needed. The Edge and Node WebAssembly binaries are embedded as bytes,
so nothing imports a `.wasm` module and no bundler setup is required.

Verified with an empty config on Next.js 15 (`middleware.ts`, webpack) and
Next.js 16 (`proxy.ts`, Turbopack).

> `withI18nFs` is **deprecated** and now returns your config untouched. It used
> to enable a webpack experiment, and on Next.js 16 that broke the build:
> Turbopack is the default and rejects a project carrying a `webpack` config
> with no `turbopack` config. Delete the call.

## The matcher

**Write it out literally.** Next.js reads it by static analysis at build time and
rejects an imported identifier:

```
Next.js can't recognize the exported `config` field in route "/proxy":
Unknown identifier "DEFAULT_MATCHER" at "config.matcher".
```

That is why this package cannot hand you a constant for it. `RECOMMENDED_MATCHER`
is exported for documentation and tests only.

**Mind the double backslash.** `'\.'` in a JavaScript string is just `.`, which
turns the file-extension exclusion into "any character" — and the proxy then
stops running on every path except `/`, silently, with no error anywhere:

```ts
matcher: ['/((?!_next/|api/|.*\\.[^/]*$).*)'],   // correct
matcher: ['/((?!_next/|api/|.*\.[^/]*$).*)'],    // matches nothing but "/"
```

The pattern excludes `/_next/`, `/api/`, and anything whose last segment
contains a dot. The core re-checks the same paths itself, so a mistake here
cannot on its own produce a redirect loop on a static asset — but it can stop
locale resolution entirely, which is worth checking first if nothing seems to
work.

## What it does per request

1. reads the pathname, `Host`, the locale cookie and `Accept-Language`;
2. asks the Rust core for a decision;
3. turns that into one of:
   - **next** — nothing to do
   - **rewrite** — serve `/[locale]/…` without changing the URL
   - **redirect** — 308 when the canonical form is the same for every visitor,
     307 when it depends on this one
4. sets the locale cookie when the resolved locale is new;
5. forwards the locale to the server layer as a request header.

Two headers are involved:

| header | purpose |
| --- | --- |
| `x-i18n-fs-locale` | carries the resolved locale to Server Components; echoed on the response so it is visible in devtools |
| `x-i18n-fs-resolved` | marks a request a previous pass already handled — the last-resort loop breaker |

## Composing with your own logic

```ts
import { NextResponse } from 'next/server';
import { createI18nProxy } from 'i18n-fs/proxy';
import i18nConfig from './.i18n-fs/config.mjs';

export default createI18nProxy(i18nConfig, {
	before(request) {
		if (request.nextUrl.pathname.startsWith('/admin') && !isSignedIn(request)) {
			return NextResponse.redirect(new URL('/login', request.url));
		}
		// Returning nothing continues to locale resolution.
	},
});
```

`before` runs first. Return a response to short-circuit, or nothing to continue.
It exists so composing with other middleware does not require reimplementing
this one.

## Do you need it at all?

Yes, for anything that resolves a locale from the request — which is every
strategy. It is what reads `Accept-Language`, applies the routing strategy, and
rewrites to `app/[locale]/…`.

Without it, `/about` will not find a route, because the router is looking for
`app/[locale]/about` and nothing rewrote the path.

## Troubleshooting

**Nothing is translated and there are no redirects.** Check the matcher's
backslashes first, then look for `x-i18n-fs-locale` on the response — if it is
absent, the proxy did not run for that path.

**A 404 on every page.** `app/[locale]/` is probably missing. It is required in
every prefix mode, including `never`.

**"Cannot find module './.i18n-fs/config.mjs'".** Run `i18n-fs build` before
`next build`, or add it to your `dev` and `build` scripts.

<!-- nav:start -->

---

| | | |
| :-- | :--: | --: |
| ← [Routing](./routing.md) | [All guides](../README.md) | [The CLI](./cli.md) → |

<!-- nav:end -->

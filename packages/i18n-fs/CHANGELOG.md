# i18n-fs

## 0.3.0

### Minor Changes

- a4d708c: Message files now hot-reload in development, failed loads say what clears them, and lookups no longer allocate.

  Editing a translation while the dev server ran did nothing visible. Message files live under `public/`, so changing one reloads no module and Next.js had nothing to re-run — the server kept serving its cached copy until it was restarted, and the browser kept serving its own. The server now compares the file's timestamp before trusting its cache, and the client fetches with `cache: 'no-store'`, both only in development. Production stats nothing: the files cannot change under a running build.

  A failed load is still remembered rather than retried, because a re-render is not evidence that a missing file has appeared and retrying per render would turn one 404 into a stream. What was missing is that nothing said so, so a transient failure looked like a permanent bug. Each diagnostic now names what clears it: fix the file (server, development), restart (server, production), reload the page (client).

  Lookups were building a string on every call — `format!("{scope}.{key}")` when scoped, a copy of the key when not. Both are gone: an unscoped lookup hashes the caller's key as it stands, and a scoped one joins on the stack. Measured on the same machine, scoped resolution is 58% faster and unscoped 50%.

  No API changed.

### Patch Changes

- 9f04e89: Verify both Next.js file conventions in CI.

  Next.js 16 renamed the proxy file convention and deprecated the old name, so the
  package supports two. Only one was covered by an automated test; the other was
  checked by hand, which is the same as not being checked at all a month from now.

  There are two example apps now — `next-16-proxy` and `next-15-middleware` — and
  both run the same assertions from `examples/shared`, so behaving identically
  across two Next.js majors and two conventions is proven rather than assumed.

  No published behaviour changes.

## 0.2.0

### Minor Changes

- 945a703: Error codes are numbers you can import, and the proxy has its Next.js 16 name.

  **Breaking.** `error.code` was a string like `'KEY_NOT_FOUND'`; it is now a
  number, and `ErrorCode` is a value you import rather than a type you can only
  annotate with:

  ```ts
  import { ErrorCode, errorCodeName, isLookupError } from 'i18n-fs';

  if (error.code === ErrorCode.KeyNotFound) { … }
  ```

  Codes are grouped so a whole class of problem is one comparison away — `1xx`
  the namespace could not be used, `2xx` the lookup inside it failed, `3xx`
  formatting, `4xx` configuration — with `isNamespaceError` and `isLookupError`
  for the common cases. Diagnostics print the name beside the number, because a
  console is read by people.

  **`createI18nProxy`.** Next.js 16 renamed the file convention from `middleware`
  to `proxy` and deprecated the old name. `createI18nProxy` and the
  `i18n-fs/proxy` entry point match it; `createI18nMiddleware` is the identical
  function and still exported, so upgrading Next.js does not force two changes at
  once.

  **`withI18nFs` is deprecated and now returns your config untouched.** It enabled
  a webpack experiment the package no longer needs, and Next.js 16 rejects a
  project that has a `webpack` config and no `turbopack` config — so calling it
  broke the build. **No `next.config` changes are needed at all**, verified on
  Next.js 15 with `middleware.ts` and Next.js 16 with `proxy.ts`.

### Patch Changes

- 356122e: Complete documentation.

  Seven guides under `docs/guide/`: getting started, folder structure,
  translating, routing, the proxy, the CLI, errors, and a full API reference by
  entry point.

  The gaps this closes:

  - **`app/[locale]/` was never mentioned.** It is required in every prefix mode
    including `never`, because the proxy always rewrites to a locale-prefixed
    internal path even when the URL shows none.
  - **`t.array`, `t.rich`, `t.has` and `t.raw`** each have a section now, rather
    than a line in a list.
  - **Routing strategies** are explained with their trade-offs, not just named.
  - **The proxy** has a guide covering the Next.js 16 rename, the matcher's
    double-backslash trap, composition and troubleshooting.

  `README.md` now leads with what actually distinguishes the package rather than
  with a fallback policy.

  `pnpm check:docs` verifies every relative link resolves, every documented export
  exists in the built declarations, no documented name has been renamed away, and
  the error code table matches the source. It runs in CI.

## 0.1.1

### Patch Changes

- 5f58632: Report the real package version.

  `coreVersion()` returned `0.0.0` in 0.1.0 — the Rust crate's version, which is
  never published and never moves — while the package was `0.1.0`. Two doc
  comments claimed the JavaScript asserted the two agreed; nothing did.

  The npm version is now stamped into each WebAssembly binary at build time, and
  the loader compares it against the version compiled into the JavaScript,
  refusing to start when they differ. The two halves encode the same routing and
  resolution rules, so a stale `wasm/` directory would apply the old ones while
  the JavaScript applied the new — producing wrong output rather than an error.

  Also adds a `VERSION` export, which is what you want in a bug report.

## 0.1.0

### Minor Changes

- c4695f7: First release.

  Folder-based internationalisation for Next.js, with locale negotiation, route
  canonicalisation, message resolution and rich-text parsing written in Rust and
  compiled to three WebAssembly binaries — one per runtime, so the Edge middleware
  carries only what middleware needs.

  - **`i18n-fs/server`** — `getLocale`, `getTranslation`, `I18nProvider`
  - **`i18n-fs/client`** — `useTranslation`, `useLocale`
  - **`i18n-fs/navigation`** — `Link`, `useRouter`, `usePathname`, `useLocaleSwitcher`
  - **`i18n-fs/middleware`** — `createI18nMiddleware`
  - **`i18n-fs`** (bin) — `i18n-fs check` and `i18n-fs build`

  Two things worth knowing before you adopt it:

  - **A missing translation never falls back to another language.** It falls back
    to the string you supply, or to the key, and tells you in the console exactly
    which of "file missing", "invalid JSON", "scope absent", "key absent" or
    "wrong shape" happened. `i18n-fs check` turns those into build failures.
  - **Routing is loop-safe by construction.** Canonicalisation is idempotent and
    redirects preserve the locale that was asked for; both are asserted by
    property tests over thousands of generated cases, and again end-to-end against
    a real Next.js server.

  Requires Node 22.18 or newer.

# i18n-fs

## 0.7.2

### Patch Changes

- e3bf1a4: The release check now asks the remote, because the check added yesterday was looking at the wrong thing.

  It compared the changelog against local git tags. Every one of the five missing tags was present locally the whole time — unpushed — so that check would have passed throughout the problem it was written for. It also failed in a state that is entirely correct: between merging a version pull request and publishing, the changelog names a version that has no tag yet, which turned the suite red for a legitimate window.

  `npm run releases:check` compares the npm registry against `git ls-remote` and against the GitHub releases, reports each gap separately because they fail separately, and exits non-zero. Tags are reported, never created: a tag names a commit, and guessing which one is not a script's job — it prints the `git push` to run instead.

## 0.7.1

### Patch Changes

- 7b458ce: Publishing now pushes its tag, and the missing tags and GitHub releases have been filled in.

  `changeset publish` writes a git tag locally and nothing pushes it. While publishing ran in CI that did not matter — `changesets/action` pushed the tag and opened a GitHub release in the same step — but that step only runs when an npm credential is present, and publishing here is manual. So 0.3.0 through 0.7.0 reached npm with no tag on the remote and no release: five versions where nothing connected the published package to the commit it was built from.

  `npm run release` ends with `git push --follow-tags` now, and a test fails when the newest changelog entry has no tag behind it — the symptom otherwise is silence, which is how this lasted five versions.

  All eight tags are on the remote, and every published version has a GitHub release whose notes are its own changelog section rather than a second description written by hand. `npm run releases:check` reports gaps; `npm run releases:create` fills them.

## 0.7.0

### Minor Changes

- 5dcd2ea: The generated key registry is now connected to `t`. A mistyped key is a compile error, which the README has claimed since 0.1.0 and which was not true.

  `i18n-fs build` has always written `.i18n-fs/messages.d.ts` listing every namespace, scope and key, and it has always been accurate. Nothing read it. `getTranslation` took a `string`, `t` took a `string`, and `t('titel')` compiled — for six published versions, while the README promised otherwise.

  `getTranslation` and `useTranslation` are generic over that registry now, so all of these fail to compile:

  ```ts
  const t = await getTranslation("home/hero", "hero");

  t("titel"); // not assignable to '"title"'
  t.array("title"); // 'title' is text, not a list
  t("bullets"); // 'bullets' is a list, not text

  await getTranslation("home/heroo"); // no such namespace
  await getTranslation("home/hero", "heor"); // no such scope
  ```

  A scope with no lists at all reports `this scope has no list keys` rather than a message about `never`.

  **Nothing breaks in a project that has not run `i18n-fs build`**: with an empty registry every namespace, scope and key is accepted, exactly as before. `Translator` written without type arguments still means "any key", so existing annotations keep working.

  **`unknownKey` is new**, for the two cases a union cannot describe: a key assembled at runtime, and a key you know is absent. It does nothing at runtime — a function rather than `as never` so the intent stays visible in a diff.

  One line of setup, which the guide already documented and the example apps did not follow: `.i18n-fs/**/*.d.ts` has to be named in `tsconfig.json`, because TypeScript skips directories beginning with a dot. Without it every key is `string` again.

## 0.6.1

### Patch Changes

- 0d2c3bf: A release build warned that a function was unused, and nothing had ever checked the combination it was unused in.

  `cargo clippy --all-features` compiles a configuration nobody runs: every helper has a caller there, so nothing looks dead. The Edge binary is built with `--features routing` alone, and in that build the serde helpers had no callers after the primitive-boundary change. The first thing to notice was `npm run release`.

  CI now lints each of the three feature sets that are actually built — `routing`, `full`, and `full,cli,routing` — and the helpers are gated to match their real callers rather than carrying `#[allow(dead_code)]`. Allowing dead code is what let the compiler be right and silent at the same time.

  Removing that dead code took the Edge binary from 38.3 KB to **37.8 KB** gzip, which was not the point but is welcome.

  `wasm-pack` also warned on every build that the crate had no licence file beside it. `scripts/build-wasm.mjs` copies the repository's own, rather than committing a second copy that could drift from the first.

## 0.6.0

### Minor Changes

- e099c44: The Edge binary is 37% smaller: 38.3 KB gzip, down from 60.4 KB.

  It carried `serde-wasm-bindgen` in order to deserialise the configuration on every request — roughly a third of the binary, for a value that does not change while the process lives. ADR 0001 recorded this as the known cost and the known fix; this is the fix.

  Routing now crosses the WebAssembly boundary as a `Router` built once from primitives — plain strings, numbers and booleans — which then answers questions. `serde` is not compiled into the Edge binary at all. That is asserted rather than assumed: the surface test decodes the embedded bytes and fails if serde's own error strings appear in them.

  This matters more than the browser reduction that preceded it. The browser binary is downloaded once per visitor; this one is instantiated on **every request**.

  The exported WebAssembly surface changed, so `EdgeCore` did too: the five free functions are gone and `Router` replaces them, reached through `loadRouter(config)`. `Decision` is flat now — `action` is `'next' | 'rewrite' | 'redirect'` with `path` and `permanent` beside it, rather than a tagged union, because a union would have to cross as a serialised object. Nothing in the public API of the package changed; `createI18nProxy`, `getTranslation` and the hooks are untouched.

### Patch Changes

- 02160f7: `i18n-fs check` now rejects a locale that can never be selected.

  A domain may opt into serving extra locales — `{ domain: 'example.com', locale: 'en', locales: ['de-AT'] }` — and those are reachable only through a URL prefix, which is what opting in means. Pairing that with `prefix: 'never'` asks for something impossible: the prefix is removed, so `de-AT` is declared and unreachable.

  Nothing broke, which is why this needed catching rather than fixing. The router resolves it deterministically and does not loop — that is covered by the property tests — so the only symptom was a page rendering in the wrong language with nothing to explain why. It is now an `INVALID_CONFIG` at build time, naming the domain and saying what to use instead.

  Recorded as future work in ADR 0004 when the loop-prevention work found it; the ADR is updated.

## 0.5.0

### Minor Changes

- aedd25a: A nested `<I18nProvider>` now extends the one above it instead of replacing it.

  Putting a provider on a route rather than at the root is a real size optimisation — a dashboard can ship six namespaces to nobody but the dashboard. Until now the inner provider replaced the context, so it had to re-list every namespace its parent already sent, and forgetting one did not fail: the namespace was fetched over the network instead, the same bytes the server had already inlined into the HTML. During server rendering that fetch has no origin, so the component rendered its fallback and filled in after hydration.

  An inner provider now lists only what its section adds. Naming the same namespace in both is still allowed and the inner one wins, which is how a section ships its own copy of a shared namespace.

  Inheritance stops at a change of locale: a provider whose locale differs from the one above it starts from nothing, because handing one locale's messages to the other's subtree would be worse than making it list them again.

  The README now carries what the choice costs, measured on three namespaces of 13.5 KB each: 13.0 KB over the wire with `namespaces`, 2.2 KB with `prefetch`, 2.0 KB with neither. Minifying the JSON is not worth doing — 3% smaller on disk, 0.1 KB after gzip.

### Patch Changes

- f12bc46: The guides read as a sequence instead of eight dead ends.

  Every guide now ends with `← previous · All guides · next →`, in a deliberate reading order: setup, then where files go, then reading a message, then how the URL carries the locale, then the proxy that makes routing work, then the build-time tools, then what happens when something is wrong, then the reference. Reaching the end of a page no longer means going back to the index to find out what comes next.

  The footers are generated by `npm run docs:nav` and checked in CI, because a hand-maintained footer is correct on the day it is written — inserting a page means editing two neighbours, and the once somebody forgets, the sequence has a hole in it.

  Prefetching gained the part that was missing: not what the three options do, which was already written down, but which one to reach for. A four-question list that stops at the first yes, a worked example using all of them in one layout, and how to confirm in the network panel that a prefetch actually matched the read rather than doubling it.

- 219e1d1: The lockfile now follows a release instead of lagging one version behind.

  `changeset version` bumps `package.json` and leaves `package-lock.json` alone, so every published version left the committed lockfile naming the previous one. `npm ci` tolerates the mismatch, which is exactly why nobody noticed — the only symptom is that the first `npm install` after a release leaves a modified file nobody asked for, on someone else's branch.

  The release script refreshes the lockfile as part of versioning, and a test asserts the two agree.

- 5814eb0: The floor of `peerDependencies` is now tested, not assumed.

  `peerDependencies` allows `next@^14.2` and `react@^18.3`, and nothing tested either — both example apps were on Next 15/16 with React 19. `examples/next-14-react-18` closes that, running the same 25 assertions as the others.

  It exists for one claim in particular. `useTranslation` calls React's `use()`, which is not in the React 18 release, so the declared range looked wrong. It is not: the App Router does not run the React in your `package.json` — Next vendors its own, and 14.2.33 vendors `18.3.0-canary-178c267a4e` with `use()` in it. Verified from the vendored build rather than inferred.

- bc281e2: Say what `namespaces` actually does, and what happens when providers nest.

  `namespaces` and `prefetch` were easy to read as two spellings of the same idea. They are opposites. `namespaces` **serialises the JSON into the HTML** — nothing to wait for, and every visitor carries those bytes whether or not the component that reads them renders. `prefetch` emits a `<link rel="preload">` and adds nothing to the document. The guides now say the first part in those words instead of "the payload grows".

  Nesting a provider is documented for the first time, along with the surprise in it: an inner provider **replaces** the context rather than extending it, so it must list every namespace its subtree reads — including ones the outer provider already sends. Leaving one out still renders, which is what makes it worth stating: the namespace is fetched over the network instead, the same file the server already inlined into the HTML, and during server rendering that fetch has no origin so the component renders its fallback.

  Two tests pin both halves of that: the fetch that happens when the inner provider omits a namespace, and the fetch that does _not_ happen when something above already read it.

## 0.4.0

### Minor Changes

- 8a8cc8f: Prefetching, so a Client Component does not wait for its namespace.

  Until now there were two settings: name a namespace in `<I18nProvider namespaces>` and it is inlined into the HTML for every visitor whether or not it is read, or leave it out and the browser starts fetching only after hydration. This adds the middle.

  `<I18nProvider prefetch={['settings/panel']}>` emits a `<link rel="preload">`. The request goes out with the HTML, in parallel with the JavaScript, and the payload does not grow. Use it for a client-only subtree or a panel that opens shortly after the page settles.

  `usePrefetch()` starts the request on intent instead, which costs nothing for visitors who never open the thing:

  ```tsx
  const prefetch = usePrefetch();
  const warm = () => prefetch("settings/panel");

  <button onPointerEnter={warm} onFocus={warm} onClick={open}>
    Settings
  </button>;
  ```

  `onFocus` as well as `onPointerEnter`, because a keyboard user never hovers and a touch user has no hover at all.

  **A failed prefetch is forgotten.** A failed read is remembered, so one 404 does not become a request per render — but a prefetch is a guess, and caching a failed guess would let a moment of bad network decide that a namespace is missing for the rest of the page's life. The component that actually needs it would render fallbacks having never tried.

  Verified in a browser on both example apps: the preload is reused rather than re-downloaded, the panel opens without suspending, and the console is clean. The `crossorigin` attribute is required for that even though the request is same-origin — without it the browser downloads the file twice, which is how the first attempt was caught.

- f5c7a8c: The browser binary is 38% smaller: 55.7 KB gzip, down from 89.9 KB.

  It was carrying locale negotiation, route canonicalisation and config validation — none of which a browser ever executes. `<Link>` and `usePathname` are answered by a TypeScript mirror of the same rules so they can stay synchronous, and every redirect decision is made by the proxy before the page is served. That was 34 KB gzip on every visit, for code that never ran.

  Routing is now a cargo feature, and each of the three binaries names exactly what it needs: the proxy gets routing, the browser gets messages, the server gets both. Every build passes `--no-default-features`, so a feature added later cannot quietly land in the binary a visitor downloads.

  | binary                           | before       | after                             |
  | -------------------------------- | ------------ | --------------------------------- |
  | browser (downloaded by visitors) | 89.9 KB gzip | **55.7 KB gzip** (47.8 KB brotli) |
  | edge (runs on every request)     | 60.4 KB gzip | unchanged                         |
  | node (read from disk)            | 93.6 KB gzip | unchanged                         |

  Nothing is downloaded at all by a page that translates only in Server Components — the browser binary is fetched lazily, and only when a Client Component calls `useTranslation`.

  `loadMessageCore()` is new and is what a Client Component should reach for. `loadFullCore()` now means both halves, which only the Node binary has, and rejects elsewhere with a message naming the right loader; `loadCore()` rejects in the browser for the same reason. If you only use `useTranslation`, `getTranslation` and the navigation wrappers, nothing changes.

- 22a381d: The public surface now matches the documentation, and navigation has one home.

  Both layer entries exported roughly twice what the guide describes. `i18n-fs/server` offered `clearMessageCache`, `resetI18nConfig`, `resetReporter`, `resolveLocaleFromRequest`, `isSafeNamespace`, `namespacePath`, `readLocaleManifest` and `getRequestLocale`; `i18n-fs/client` offered `loadClientNamespace`, `stateFromPayload`, `seedNamespace`, `hasNamespace`, `clearNamespaceCache`, `namespaceUrl`, `prefetchNamespace` and `resetClientReporter`. They are the machinery behind `getTranslation` and `useTranslation`, not an API — the tests import them from source and nothing outside the package ever called them — but every one was a promise kept under semver. They are internal now.

  The four lower-level loaders the guide documents for tooling — `loadNamespace`, `loadNamespaces`, `readRawNamespaces`, `readManifest` — stay.

  **`<Link>`, `useRouter`, `usePathname` and `useLocaleSwitcher` are now only in `i18n-fs/navigation`.** They were in `i18n-fs/client` as well, which left two import paths for one thing. If you import them from `i18n-fs/client`, change the path to `i18n-fs/navigation`; nothing else changes. `useLocale`, `useTranslation`, `usePrefetch` and `useI18nContext` stay in `i18n-fs/client`.

  The single React context that made the old arrangement necessary is preserved: `i18n-fs/navigation` now carries the implementation and reaches the context through `i18n-fs/client`, so there is still exactly one context module. A second one is what produced "No I18nProvider found" on a page that plainly had one, so it is asserted twice — CI counts `createContext` in the built entry, and a test pins every entry's exports so an accidental export fails as loudly as a missing one.

  `usePrefetch` was documented under `i18n-fs/server`. It is a client hook and is now documented where it lives.

  The README's size table now reports only the WebAssembly binary. It used to add every JavaScript chunk that mentioned it, which attributed the example app's own pages to this package — and the figure moved when the example changed, which is how the mistake surfaced.

### Patch Changes

- c7d6933: An audit of the documentation against the code, and the one type that was wrong.

  `t.rich` accepts a React element as a parameter — the runtime has always substituted after tokenising, precisely so an element stays an element — but the public type said `string | number`, so the documented example did not type-check. The test that claimed to cover it passed the string `'Ali'`. `RichTranslationParams` now types it, and the test passes an actual element.

  Corrections where the documentation described behaviour the code does not have:

  - **Suspension.** "A namespace in `namespaces` does not suspend at all" was wrong. `useTranslation` reads the WebAssembly core through `use()` before it looks at the namespace, so the _first_ Client Component to translate anything waits for the core regardless. Pre-loading removes the fetch, not the suspension — and a reader following the old text would omit the boundary the first render needs.
  - **Failed loads in development.** The table said a server-side failure lasts "until the file changes". It is not cached in development at all, so it is retried on the next render.
  - **The sample console line** in the errors guide carried two sentences the reporter has never printed.
  - **The architecture notes** described `bundler`/`nodejs` wasm-pack targets, a two-loader interface, cargo features from before routing became one, and an entry-point table without `i18n-fs/proxy`.
  - `CONFIG_DEFAULTS` and `I18nClientProvider` are exported and were documented nowhere.
  - The module comment shipped in `src/index.ts` still said the React layers would "land in later pull requests".

  The doc checker now also compares the sample console line against the reporter, since that one drifted because nothing was watching it.

  No behaviour changed.

- 70b3745: The README now states what the package costs a visitor, measured rather than claimed.

  Bundle size is a reasonable thing to decide a dependency on, and until now the answer was not written down anywhere. It is now the third section of the README: what a page downloads with Server Components only (nothing), what it downloads when a Client Component calls `useTranslation`, and the size of all three WebAssembly binaries including the two a visitor never receives.

  The numbers are generated by `npm run measure` from the binaries and the example app as they were actually built, and stamped with the date and version they were taken from. Numbers typed into prose rot silently — a reader cannot tell a stale figure from a true one — so CI runs `npm run measure:check` on every pull request and fails when the documented sizes no longer match the built ones. `npm run release` runs the same check before publishing.

  No code changes.

- c7d6933: Prove, and keep proving, that you pay only for what you import.

  Tree-shaking already worked — `sideEffects: false` is declared and bundlers honour it — but nothing in the repository would have noticed if that stopped being true. The only symptom of a regression is a larger download, which no type checker and no runtime test can see.

  Measured by bundling one import at a time: `ErrorCode`, `VERSION` and `defineConfig` cost under a kilobyte; `Link`, `useRouter`, `usePathname`, `useLocaleSwitcher`, `useLocale` and `useI18nContext` cost one to two kilobytes and carry **no WebAssembly at all**; only `useTranslation` and the core loaders pull the binary, because resolving a message needs it.

  Confirmed through a real Next.js build too: an app that navigates and switches locale on the client, but translates only in Server Components, emits no `.wasm`.

  `test/tree-shaking.test.ts` now bundles each import and fails if one starts pulling the core, or if the side-effect declaration disappears. Verified by making `useLocale` depend on the core: the test fails by name.

  The README states the guarantee where a reader deciding on a dependency will see it.

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

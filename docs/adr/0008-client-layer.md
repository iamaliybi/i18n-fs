# ADR 0008 — The client layer and suspension

Status: accepted
Date: 2026-08-22

## Context

`useTranslation` has to return a translator synchronously — components call
`t('key')` in their bodies — while the namespace behind it may not have arrived.
The prototype handled this by throwing a promise from inside the hook and
tracking its progress in a local variable:

```ts
let isTranslationsLoaded: 0 | 1 | 2 = 0;
if (isTranslationsLoaded === 0 && !messagesCache.has(nKey)) {
	throw loadTranslations(namespace).then(() => { isTranslationsLoaded = 2; });
}
```

The variable is local to the hook, so the very re-render the thrown promise
triggers resets it to `0`. It never settles.

## Decisions

### The promise cache lives at module scope

React's `use()` identifies a suspended read by **promise identity**. Every read
of the same namespace must therefore receive the same promise *object*, not
merely an equivalent one. A promise created during render — in the hook body, in
a `useMemo`, in a ref — is a new one on each attempt, and the component suspends
forever.

So `namespaces.ts` holds a `Map<string, Promise<NamespaceState>>` at module
scope, keyed by locale and namespace. That is also what makes three components
asking for the same namespace produce one fetch rather than three.

`loadFullCore()` had the same problem: it was an `async function`, so it
returned a fresh promise per call. It is now memoised too.

### The suspended promise never rejects

A failed load resolves to `{ status: 'failed', error }`. One missing or
malformed translation file must not throw the page to an error boundary — it
degrades per key through the same fallback path as everything else, with its own
diagnostic code. This mirrors the server layer, deliberately: the two must not
disagree about what a missing file means.

### Server-sent namespaces are seeded into the same cache

The provider sends the namespaces it was asked for. The hook turns each into a
store once and seeds it into the *same* cache the fetching path uses, so both
routes converge and a later component reading it does not suspend.

Building the store costs one native `JSON.stringify` of an object the server
already parsed. The alternative was a `Store.fromObject` binding taking the
object graph across the WASM boundary directly. It was written, measured, and
removed: it added **1.6 KB gzip to the browser binary on every page**, pushing it
past its budget, and walking a JS object property-by-property through
`serde-wasm-bindgen` is not obviously faster than parsing a string once. A native
stringify is the cheaper trade.

### Fetched namespaces carry the content hash

Files under `public/` are served verbatim and are not fingerprinted, so
`/locales/fa/home.json` alone cannot be cached immutably. The provider sends the
current locale's slice of `.i18n-fs/manifest.json` and the hook appends
`?v=<hash>`.

The manifest is sent for **every** namespace of the locale, not just the
pre-loaded ones — a Client Component may ask for one the server did not send,
and that is exactly the request that needs a cacheable URL. If `i18n-fs build`
has not run there is no manifest; the hook then fetches unversioned URLs, which
still work and simply are not immutably cacheable. Failing a render over a
caching optimisation would be the wrong trade.

### One reporter per page

Per-hook reporters would each keep their own "already logged" set, so a missing
key used in five components would be logged five times, and again on every
remount. The reporter is module-scoped, matching the server layer.

## Consequences

- `useTranslation` is synchronous and `getTranslation` is async. That asymmetry
  is inherent — the server reads from disk, the client reads from context or
  suspends — and papering over it would make one of them worse.
- A `<Suspense>` boundary above any component reading a namespace the server did
  not send controls what shows meanwhile. Pre-loading through the provider's
  `namespaces` prop avoids the suspension entirely.
- The cache is per page load. A locale switch reloads the page (a project
  requirement), so there is no stale-locale case to invalidate.

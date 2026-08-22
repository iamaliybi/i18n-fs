# ADR 0007 — The server layer, and the server/client boundary

Status: accepted
Date: 2026-08-22

## Context

The requirement is that on every full page load the locale comes from the
request itself — `Accept-Language` and cookies — and is then held in a React
context for the client. In the App Router that splits across two worlds: Server
Components can read headers and the filesystem, Client Components can do
neither.

## Decisions

### Locale resolution is a pure function

`resolveLocaleFromRequest(config, signals, negotiate)` takes four values and
returns a locale. Reading them out of `next/headers` is a thin wrapper around
it. That keeps the ordering rules written down in one testable place, and it is
why the rules are covered without standing up a Next.js server.

The order, most authoritative first:

1. an override the app pinned for this request;
2. the header the middleware set, which already applied the routing strategy;
3. the cookie, which is the user's own stated choice;
4. `Accept-Language`;
5. the configured default.

**Anything that is not a configured locale is discarded, not trusted.** Every
one of those values arrives from the client, and a locale goes straight into a
filesystem path.

### `setRequestLocale` uses React's `cache()`, not a module variable

Under the path strategy the `[locale]` segment is authoritative, and a Server
Component cannot read the pathname — so the app has to be able to pin it. Doing
that in a module-level variable would leak the last request's locale into the
next one, which on a busy server means serving a reader somebody else's
language. `cache()` scopes it to one request.

`getLocale` is memoised the same way, so a layout and everything beneath it
agree and the headers are read once.

### Failing to load a namespace is not an exception

`loadNamespace` returns `{ status: 'failed', error }` rather than throwing. One
missing or malformed file must not blank a page; it degrades per key through the
normal fallback path, with its own diagnostic code. The state is carried into
the translator, which reports it against the key that asked for it — so the
message names a call site the developer can find rather than a file they have to
go looking for.

### Namespaces are validated as paths

A namespace becomes a path under `public/`, and it is not always application
code that chooses it — a route segment or a CMS value can reach it. `..` would
read arbitrary files off the disk and, through the provider, hand them to the
browser. `isSafeNamespace` rejects absolute paths, drive letters and any `..`
segment before anything touches the filesystem.

### Namespaces are cached, except failures in development

Message files are build-time assets, so parsing them once per process is right
and the cache is bounded by the number of files rather than by traffic.
Failures are the exception: in debug mode a failed load is not cached, because
otherwise fixing a typo would need a server restart to observe.

### The provider sends only what it is asked for

`I18nProvider` serialises the namespaces named in its `namespaces` prop and
nothing else. Sending the whole tree would be simpler and would put every
string of every page into the payload of each one. Server Components load what
they need themselves; the prop exists for Client Components, which cannot.

### `'use client'` needs a real module boundary

The provider is a Server Component that renders a Client Component. If it
imported the context by relative path, the bundler would inline it into the
server chunk and the boundary would disappear. So the client layer is its own
entry point and the provider self-references it as `i18n-fs/client`.

esbuild also strips module-level directives when bundling, so the directive is
restored afterwards by `scripts/postbuild.mjs`, alongside the CLI's shebang. Two
things, one place, both documented — the alternative is a global tsup banner
that would put `'use client'` in every file.

### The translator is shared, and framework-agnostic

`createTranslator` is handed an already-loaded namespace and does no I/O. The
server layer and the client hook differ only in how they obtain that namespace,
so a lookup cannot behave differently in the browser than it did during SSR, and
a diagnostic cannot say one thing on one side and something else on the other.

`t.rich` returns React output, and parameters are substituted *after*
tokenising. Interpolating first would stringify a React element passed as a
parameter, which is exactly the case rich messages exist for.

## Consequences

- `getTranslation` is async because loading is; `useTranslation` will not be,
  because the client hook resolves against messages already in context or
  suspends. That asymmetry is inherent to the two environments.
- The reporter is per-process, not per-call, or de-duplication would not
  de-duplicate and a missing key in a re-rendering component would fill the
  console.
- `configureI18n` exists as an escape hatch for deployments where importing
  `.i18n-fs/config.mjs` from the working directory does not resolve. The common
  case needs no wiring.

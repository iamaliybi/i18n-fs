# Architecture

`i18n-fs` is folder-based internationalisation for Next.js, with the parsing and
routing logic written in Rust and compiled to WebAssembly.

This document describes the shape of the system. The reasoning behind each
choice is in [`docs/adr/`](adr/).

## Layout

```
crates/i18n-fs-core/     pure logic: no I/O, no clock, no globals
crates/i18n-fs-wasm/     wasm-bindgen bindings; three build targets
packages/i18n-fs/        the npm package
docs/adr/                architecture decision records
scripts/                 wasm build, size budget, artefact sync
```

## The core

`i18n-fs-core` is a deterministic function of its inputs. That is what lets the
same code back the Edge middleware, the Node server runtime, the browser bundle
and the build-time CLI — and what makes the loop guarantee testable.

| module    | feature       | responsibility                                     |
| --------- | ------------- | -------------------------------------------------- |
| `config`  | always        | the compiled configuration snapshot                 |
| `locale`  | always        | BCP-47 parsing, RFC 4647 `Accept-Language` matching |
| `routing` | always        | canonicalisation and the middleware decision        |
| `error`   | always        | the error taxonomy                                  |
| `store`   | `full`        | namespace flattening, `scope`/`key` resolution      |
| `format`  | `full`        | interpolation and rich-text tokenisation            |

`diagnostics` (implied by `full`) adds config validation and human-readable
error rendering. The Edge build has none of it. `cli` adds namespace
introspection — which keys exist and what shape each holds — and is compiled
into the Node build only, because the browser resolves messages and never lists
them.

## The three binaries

One crate, three outputs. See [ADR 0001](adr/0001-wasm-boundary.md).

```
                      cargo features        wasm-pack target   binary
  edge      middleware   (none)                 web            embedded
  browser   client       full                   web            fetched
  node      server, CLI  full + cli             web            embedded
```

The Edge and Node binaries are embedded as base64 rather than loaded from disk.
Neither runtime can be relied on to find a sibling file — bundlers rewrite the
`__dirname` a Node lookup needs, and the Edge runtime has no base URL to resolve
a relative one against — and both failures appear only at request time in
production. The browser keeps a real `.wasm` module, because there the bytes are
paid for over the network. See [ADR 0009](adr/0009-middleware-and-navigation.md).

The bundler picks one through `package.json#imports` conditions, so no runtime
branching survives into shipped code. `packages/i18n-fs/src/core/` holds one
loader per target behind a single `loadCore()` / `loadFullCore()` interface;
`loadFullCore()` rejects in the Edge runtime with an explanation rather than
failing as `undefined is not a function`.

## The CLI

`i18n-fs check` and `i18n-fs build` ship as a `bin` inside the package. They run
before the app builds:

```
  i18n-fs check     config validation, JSON parsing, key and shape diff
                    across locales -> exit 1 on any error

  i18n-fs build     the same checks, then writes .i18n-fs/
                      config.mjs      resolved snapshot for every runtime
                      manifest.json   content hash per namespace, for caching
                      messages.d.ts   the typed key registry
```

`check` is what makes "no cross-language fallback" survivable: without it, a key
missing from one locale is invisible until a reader of that locale opens the
page. See [ADR 0006](adr/0006-cli.md).

## Navigation

`i18n-fs/navigation` wraps `next/link` and `next/navigation` so application code
uses locale-free paths — `/about`, never `/en/about` — and the active locale is
applied on the way out. Switching routing strategy in the config then touches no
`href` anywhere.

`useLocaleSwitcher().switchTo()` performs a **full page load**, not a client
transition: every layout above the switcher was rendered in the old locale, and
only a fresh request re-runs them.

Building a link has to be synchronous, so `src/paths.ts` mirrors two small
functions from the Rust core in TypeScript. `test/paths.test.ts` checks that
mirror against the original across every configuration, so the two cannot drift.

## Request lifecycle

```
  request
    │
    ├─ middleware (Edge)        decide(config, request)
    │      ├─ next              nothing to do
    │      ├─ rewrite           serve /[locale]/… without changing the URL
    │      └─ redirect          send to the canonical public path
    │
    ├─ root layout (Node)       getLocale() reads the middleware header, the
    │                           cookie, then Accept-Language; getTranslation()
    │                           loads namespaces from public/ with fs;
    │                           <I18nProvider namespaces={...}> hands the
    │                           locale and those namespaces to the client
    │
    └─ client                   useTranslation(namespace, scope) reads the
                                context; a namespace the server sent resolves
                                without suspending, anything else suspends on a
                                module-scoped promise and is fetched from
                                public/ with its content hash
```

Locale resolution order depends on the strategy, but the URL wins wherever the
URL is authoritative — a shared link must render the locale it names.

## Entry points

| entry | runs where | holds |
| --- | --- | --- |
| `i18n-fs` | anywhere | the core loader, config types |
| `i18n-fs/server` | Server Components | `getLocale`, `getTranslation`, `I18nProvider` |
| `i18n-fs/client` | Client Components | `useTranslation`, `useLocale`, the context |
| `i18n-fs/navigation` | Client Components | `Link`, `useRouter`, `usePathname`, `useLocaleSwitcher` |
| `i18n-fs/middleware` | Edge middleware | `createI18nMiddleware` |
| `i18n-fs/config` | build time | `defineConfig`, `withI18nFs` |

`i18n-fs/server` reads request headers and the filesystem, so importing it from
a Client Component is a build error — which is the intent. The provider is a
Server Component that renders into `i18n-fs/client`; it self-references that
entry by package path so the `'use client'` directive stays a real module
boundary the bundler can see, rather than being inlined into the server chunk.

## Translation lookup

`useTranslation(namespace, scope)` takes a file path and an object inside it:

```ts
const t = useTranslation('home/hero', 'cta');
t('label');           // public/locales/fa/home/hero.json -> cta.label
t.rich('terms', { link: (c) => <a href="/terms">{c}</a> });
t.array('bullets');
```

The folder layout beneath the locale directory is entirely the developer's.
`i18n-fs` imposes no structure and no shared-key convention; a developer who
wants shared keys injects them.

Failure behaviour is uniform — the developer's fallback string, otherwise the
key — while diagnosis is precise. See [ADR 0003](adr/0003-fallback-policy.md).

## Testing

- **cargo** — unit and integration tests per module.
- **proptest** — the invariants that example-based tests cannot cover: that
  canonicalisation is a fixed point, that following a redirect terminates *and*
  preserves the locale, that the formatter never panics and never invents text.
  Three real routing defects were found this way; see
  [ADR 0004](adr/0004-loop-prevention.md).
- **criterion** — the four hot paths, so the claim that they belong in Rust
  stays checkable.
- **vitest** — the WASM boundary from JavaScript: that the binary loads, that
  serde's renaming and the TypeScript types agree, and that errors arrive as
  structured objects.

CI runs the Rust suites in both feature sets, enforces the per-target gzip
budgets, and imports the *built* package to catch breaks in the published
layout that a source-tree test would miss.

Two example apps run end to end: `next-16-proxy` and `next-15-middleware`. The
file convention changed between those Next.js majors, and both run the same
assertions from `examples/shared`, so behaving identically across them is proven
rather than assumed.

## Decisions

Every non-obvious choice is written down, with what it cost and what was tried
first:

| ADR | subject |
| --- | --- |
| [0001](adr/0001-wasm-boundary.md) | where the Rust/WASM boundary sits, and what it measures |
| [0002](adr/0002-messages-in-public.md) | why messages live in `public/` and how they are cached |
| [0003](adr/0003-fallback-policy.md) | uniform fallback, distinct diagnosis |
| [0004](adr/0004-loop-prevention.md) | preventing redirect loops, and the three bugs the property tests found |
| [0005](adr/0005-config-snapshot.md) | compiling the config into a snapshot |
| [0006](adr/0006-cli.md) | the CLI, and why most of it is not Rust |
| [0007](adr/0007-server-layer.md) | the server layer and the server/client boundary |
| [0008](adr/0008-client-layer.md) | suspension, and why the promise cache is module-scoped |
| [0009](adr/0009-middleware-and-navigation.md) | middleware, navigation, and where the WASM actually loads |

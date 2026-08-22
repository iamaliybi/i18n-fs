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
                      cargo features        wasm-pack target
  edge      middleware   (none)                 bundler
  browser   client       full                   web
  node      server, CLI  full + cli             nodejs
```

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

## Request lifecycle

```
  request
    │
    ├─ middleware (Edge)        decide(config, request)
    │      ├─ next              nothing to do
    │      ├─ rewrite           serve /[locale]/… without changing the URL
    │      └─ redirect          send to the canonical public path
    │
    ├─ root layout (Node)       read the resolved locale from headers/cookies,
    │                           load namespaces from public/ with fs,
    │                           render <I18nProvider locale messages>
    │
    └─ client                   useTranslation(namespace, scope) reads context;
                                a namespace not yet loaded suspends on a
                                module-scoped promise cache
```

Locale resolution order depends on the strategy, but the URL wins wherever the
URL is authoritative — a shared link must render the locale it names.

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

## Status

The foundation and the core are in place. Still to come:

| PR  | scope                                                          |
| --- | -------------------------------------------------------------- |
| #3  | server layer: `getLocale`, `getTranslation`, `I18nProvider`      |
| #4  | client layer: `useTranslation` with `use()` and a stable cache   |
| #5  | middleware and the Next.js wrappers; Playwright loop tests       |
| #6  | example app, documentation, first publish                        |

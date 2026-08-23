# ADR 0001 — Where the Rust/WASM boundary sits

Status: accepted
Date: 2026-08-22

## Context

`i18n-fs` is built around a Rust core compiled to WebAssembly. WebAssembly is
not free: every binary costs download size and instantiation time, and for
small payloads `JSON.parse` in V8 is faster than `serde_json` inside WASM. So
"put it in Rust" is a decision that has to be justified per function, not once
for the project.

## Decision

Rust owns the work where it is genuinely better, and nothing else.

**In Rust:**

- BCP-47 parsing and RFC 4647 `Accept-Language` negotiation. Fiddly, spec-bound,
  and easy to get subtly wrong in a way tests do not catch.
- Route canonicalisation: adding, stripping and normalising locale prefixes.
  This is the code that prevents redirect loops, and it must be provably
  idempotent — see [ADR 0004](0004-loop-prevention.md).
- Message resolution: flattening a namespace into a dotted index and resolving
  `namespace` → `scope` → `key` with a precise reason on failure.
- Placeholder interpolation and rich-text tokenisation.
- Build-time work for the CLI: scanning the message tree, validating JSON,
  diffing keys between locales, generating types.

**In JavaScript:**

- `JSON.parse`, file and network I/O, React Context, the Next.js wrappers.
- Building JSX. **JSX never crosses the WASM boundary.** `tokenize` returns a
  plain node tree and the React layer maps each tag node to an element. A
  parameter can therefore be a React element rather than a string, which it
  could not be if substitution happened inside Rust.

## Three build targets

One crate, three binaries, because the runtimes differ in what they can load
*and* in what they should carry:

| build     | wasm-pack target | cargo features         | consumer                  |
| --------- | ---------------- | ---------------------- | ------------------------- |
| `edge`    | `web`            | `routing`              | the Next.js proxy (Edge)  |
| `browser` | `web`            | `full`                 | Client Components         |
| `node`    | `web`            | `full,cli,routing`     | Server Components, CLI    |

> Updated after the fact. This ADR originally specified the `bundler` and
> `nodejs` targets; both resolve their `.wasm` at runtime through a path that
> bundlers rewrite, which fails at request time rather than at build time. All
> three use `web` and are handed their bytes —
> [ADR 0009](0009-middleware-and-navigation.md). Routing became a separate
> feature later, so the browser binary no longer carries it —
> [ADR 0001 consequences](#consequences) and the sizes in the README.

The `edge` build is compiled without `serde_json`, message storage, formatting,
config validation or error rendering. Those are *absent from the binary*, not
merely unreferenced — tree-shaking cannot remove code from a `.wasm` file, so
this has to happen at compile time via cargo features.

Selection is made by the bundler through `package.json#imports` conditions
(`edge-light`, `workerd`, `browser`, `node`), so no runtime branching survives
into the shipped code.

## Measured cost, and the part we have not fixed

Measured at the time of writing (gzip, `wasm-opt -Oz`):

| build     | raw      | gzip     |
| --------- | -------- | -------- |
| `edge`    | 119.9 KB | 60.4 KB  |
| `browser` | 183.5 KB | 89.6 KB  |
| `node`    | 183.5 KB | 89.6 KB  |

> The browser figure stands as the measurement that prompted this ADR. It is no
> longer current: dropping routing from that build took it to 55.7 KB gzip.
> Current numbers are generated into the README by `npm run measure` and checked
> in CI, so they cannot be stale there.

The Edge number was worse than expected, so it was broken down:

| contents                                | gzip    |
| --------------------------------------- | ------- |
| wasm-bindgen glue alone                 | 6.3 KB  |
| \+ `serde-wasm-bindgen` config bridging | 32.7 KB |
| \+ locale negotiation and routing       | 60.4 KB |

**Roughly half the Edge binary is the serde bridge, not our logic.** Gating
config validation and error rendering behind a `diagnostics` feature only
recovered 3 KB, because the weight is in `serde`'s derived deserialiser for
`I18nConfig`, not in our own code.

This is recorded rather than fixed. The fix is to give the Edge build a
primitive-argument API — passing locales, default locale, strategy and prefix
mode as plain strings and integers instead of a serialised config object — which
would let it drop `serde` and `serde-wasm-bindgen` entirely. That is an API
change worth making deliberately alongside the middleware in PR #5, not
smuggled into the foundation.

Until then `scripts/build-wasm.mjs` enforces a 65 KB gzip budget on the Edge
build so it cannot drift upward unnoticed. The budget is a measured baseline,
not a target we met.

The browser and node builds carry their own budgets for the same reason. The
browser one was re-baselined from 90 KB to 95 KB in 0.3.0: removing the
per-lookup allocation cost 0.5 KB gzip and left roughly 100 bytes of headroom,
which would have made the next unrelated change to `full` code fail CI for the
wrong reason. Raising a budget is a decision to record, not a step to take when
a build turns red — and it says nothing about the Edge build, which contains no
`full` code at all.

## Consequences

- Every function in the core must justify its place. `cargo bench` covers the
  four hot paths (negotiation, routing, store, formatting) so the claim stays
  checkable rather than becoming folklore.
- Adding a dependency to `i18n-fs-core` means checking it compiles under
  `--no-default-features`, and what it costs the Edge binary.
- CI lints, tests and builds both feature sets. A change that only works with
  `full` breaks the middleware, and the default build would never notice.

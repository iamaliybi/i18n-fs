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

This was recorded rather than fixed at the time. **It is fixed now.**

The Edge build takes a primitive-argument API: a `Router` is constructed once
from plain strings, numbers and booleans, and answers routing questions
afterwards. The configuration crosses the boundary at startup rather than being
serialised into every request, which is what it always was — a value that does
not change while the process lives.

| | gzip |
| --- | --- |
| before, with the serialised config | 60.4 KB |
| after, primitives only | **38.3 KB** |

`serde` and `serde-wasm-bindgen` are not compiled into the Edge binary at all.
That is asserted rather than assumed: `wasm-surface.test.ts` decodes the
embedded bytes and fails if `serde`'s own error strings — `invalid type`,
`missing field`, `duplicate field` — appear anywhere in them.

`validateConfig` still takes a serialised config and still uses serde. It runs
in the CLI at build time, in the Node binary, which is read from disk and costs
nobody a download.

`scripts/build-wasm.mjs` enforces a gzip budget per build so none of them can
drift upward unnoticed. Each is a measured baseline rather than a target that
was met, and the reasoning for every move is recorded beside the number in that
file:

| build | budget | why it moved |
| --- | --- | --- |
| `edge` | 40 KB | was 65; the primitive boundary above took it to 38.3 |
| `browser` | 68 KB | was 95; dropping routing took it to 55.7; plural arguments took it to 63.1 ([ADR 0011](./0011-plurals-and-formatting.md)) |
| `node` | 106 KB | was 100; the same parser took it to 100.6. Read from disk, downloaded by nobody |

Raising a budget is a decision to record, not a step to take when a build turns
red. The browser one was raised once for the opposite reason — removing a
per-lookup allocation cost 0.5 KB and left about 100 bytes of headroom, which
would have failed CI on the next unrelated change — and then lowered again when
routing left that binary.

The plural parser is the clearest case of the budget doing its job. The first
version of it went 20.4 KB over, and the report is what prompted the question:
13.3 KB of that turned out to be Rust's string-to-float conversion, linked
solely to compare `=0` against `0`. Without a build that failed, that would have
shipped.

## Consequences

- Every function in the core must justify its place. `cargo bench` covers the
  four hot paths (negotiation, routing, store, formatting) so the claim stays
  checkable rather than becoming folklore.
- Adding a dependency to `i18n-fs-core` means checking it compiles under
  `--no-default-features`, and what it costs the Edge binary.
- CI lints, tests and builds both feature sets. A change that only works with
  `full` breaks the middleware, and the default build would never notice.

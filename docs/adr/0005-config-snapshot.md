# ADR 0005 — `i18n-fs.config.ts` is compiled into a snapshot

Status: accepted
Date: 2026-08-22

## Context

The configuration is written as TypeScript so developers get autocompletion and
type errors. But the same values are needed by four consumers with very
different capabilities: the CLI (Node), Server Components (Node), the browser,
and Edge middleware. Neither the Edge runtime nor WebAssembly can import a
TypeScript module.

## Decision

`i18n-fs.config.ts` is authored with `defineConfig()` and compiled once by the
CLI into a plain, fully-resolved snapshot with every optional field filled in.
The snapshot — not the source file — is what every runtime and the WASM core
receive.

`defineConfig` deliberately does not validate. Validation happens in the CLI,
against the real file, where every problem can be reported at once with a field
path (`domains[1].locale`) rather than one error per run. `I18nConfig::validate`
returns all issues, not the first.

Validation lives in Rust behind the `diagnostics` feature so the Edge build does
not carry it: a configuration that reaches production has already been validated
at build time, and re-validating it on every request would be work with no
possible outcome.

## Consequences

- The CLI must run before the app builds. That is already true for the message
  manifest ([ADR 0002](0002-messages-in-public.md)).
- The snapshot's serialised shape is a contract between the CLI and the core.
  `serde` renames to `camelCase`, and a round-trip test asserts the two
  representations agree.
- Changing a config field means touching the TypeScript interface, the Rust
  struct and the validation together. They are checked against each other by the
  round-trip test and by the WASM boundary test.

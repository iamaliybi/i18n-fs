# ADR 0003 — Uniform fallback, distinct diagnosis

Status: accepted
Date: 2026-08-22

## Context

A translation lookup can fail in several ways: the file is missing, the file is
malformed, the scope does not exist, the key does not exist, or the key holds
the wrong shape. A user should never see a raw failure. A developer should never
have to guess which of those happened.

## Decision

**Behaviour is uniform.** Every failure resolves the same way:

1. If the developer supplied a fallback string, render it.
2. Otherwise render the key itself.

**Cross-language fallback is forbidden.** A missing Persian string never renders
the English one. Silently mixing languages produces a page that looks fine to
the developer and is broken for the reader, and it hides the gap from every
process that would otherwise catch it.

**Diagnosis is precise.** Each failure carries a distinct code:

| code                  | meaning                                            |
| --------------------- | -------------------------------------------------- |
| `NAMESPACE_NOT_FOUND` | the file could not be loaded                       |
| `INVALID_JSON`        | it loaded but does not parse                       |
| `SCOPE_NOT_FOUND`     | the file parsed; the scope object is absent        |
| `KEY_NOT_FOUND`       | the scope exists; the key does not                 |
| `TYPE_MISMATCH`       | the key exists but holds the wrong shape           |
| `PARAM_MISSING`       | a `{placeholder}` had no matching parameter        |
| `INVALID_CONFIG`      | the configuration snapshot is inconsistent         |

Errors carry the locale, namespace, scope, key and a detail string — for
`INVALID_JSON` that is the parser's own message, with line and column.

Two smaller decisions follow from the same principle:

- **`null` is a missing key, not a value.** An unfinished translation reports
  `KEY_NOT_FOUND` rather than rendering `"null"` to a user.
- **A missing parameter stays visible.** `interpolate` leaves the `{name}`
  marker in the output and reports the name. An empty gap hides the bug; a
  visible marker does not.

## Logging

Diagnostics are for developers, so they are emitted in development and
de-duplicated by `I18nError::dedupe_key` — each distinct problem is logged once
per process rather than once per render. A missing key in a component that
re-renders on every keystroke should not drown the console.

## Consequences

- The core never chooses the fallback string; it returns a typed error and the
  caller decides. Policy stays in one place, at the call site.
- `console.error` output distinguishes a typo in a key from a missing file, so
  the fix follows from the message.
- Because there is no cross-language fallback, a missing translation is visible
  in every locale. The CLI's key diff (PR #2) is what turns that into a build
  failure rather than a surprise — unless a project sets `compareLocales: false`
  because its locales are not translations of one another, in which case the
  fallback above is the whole of the safety net and the diagnostic is how a
  genuine omission gets noticed.

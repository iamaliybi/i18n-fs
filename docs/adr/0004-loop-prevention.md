# ADR 0004 — Preventing redirect loops in the App Router

Status: accepted
Date: 2026-08-22

## Context

A locale-aware middleware inspects every request and can rewrite or redirect it.
That is exactly the shape that produces infinite redirect loops, and the loops
that occur in production are never the ones anybody thought to test. "We were
careful" is not a mechanism.

## Decision

Loop safety is a property of the code, asserted over generated input, backed by
a runtime guard as the last resort.

### 1. Canonicalisation is a fixed point

`canonical_public_path(config, pathname, locale, base)` is idempotent:

```
canonical_public_path(canonical_public_path(p)) == canonical_public_path(p)
```

`decide` emits a redirect only when `pathname` differs from its own canonical
form. Because the canonical form is a fixed point, the redirect target cannot
redirect again. This is asserted by property test over 4096 generated cases per
run, across every strategy and prefix mode.

Making it hold required stripping *every* leading locale segment rather than
one. `/fa/fa/about` under `prefix: never` would otherwise canonicalise to
`/fa/about` and then to `/about` — two different answers from the same input,
which is what a loop is made of.

### 2. Redirects preserve the locale

Terminating is not sufficient. A chain that settles on a *different* locale than
the request asked for is still wrong, and the property test asserts locale
preservation as well as termination. Two real defects were found this way, both
in configurations that look reasonable:

- **`as-needed` was relative to the global default locale.** Under the domain
  strategy on `example.com` (English) with a Persian global default, `/about`
  canonicalised for Persian while the host resolved it to English, and the
  request bounced between `/about` and `/en/about`. Fixed by making the
  unprefixed *base locale* the domain's own locale — see `routing::base_locale`.

- **The cookie was read where it was never written.** Under the domain strategy
  a redirect dropped the path prefix, and a stale cookie then named a different
  locale and asked for another redirect. Fixed by consulting the cookie exactly
  when it is also written: only where the hostname selects nothing (`localhost`,
  preview deployments).

A third followed from the same property: under `prefix: never` the URL cannot
express a locale, so honouring a path prefix means resolving a locale that the
very next redirect strips. Path prefixes now select a locale only in the modes
where canonical URLs keep prefixes.

### 3. Rewrites, not redirects, wherever possible

A rewrite does not change the URL and therefore cannot loop. Hiding the locale
from the URL is implemented as a rewrite from the public path to the internal
`/[locale]/…` path, never as a redirect.

### 4. The matcher, twice

The JavaScript `matcher` excludes `/_next`, `/api` and anything with a file
extension. `routing::should_handle` excludes them again in Rust, so a
mis-edited matcher cannot produce a redirect loop on a static asset.

### 5. `alreadyResolved`

A response header marks a request a previous pass resolved; such requests are
passed through untouched. Nothing above depends on it — it is the guard that
still stops a loop if a future change breaks the reasoning, and the property
test asserts it holds for arbitrary input.

## Consequences

- `canonical_public_path` takes an explicit `base` locale. Callers get it from
  `routing::base_locale(config, host)`. The extra parameter is the price of the
  domain-strategy fix and is deliberate.
- The property tests are not optional. Every one of the three defects above was
  found by them and none by the example-based tests written alongside.
- Some strategy/prefix combinations are contradictory by nature (`domain` with
  `never` and per-domain extra locales). They resolve deterministically rather
  than bouncing, and `i18n-fs check` now rejects them as well: nothing breaks at
  runtime, the extra locale is simply unreachable, and that is worse to discover
  from a page rendering in the wrong language than from a build that stops.

# 0011 — Plurals in the message, CLDR in the runtime

**Status:** accepted
**Date:** 2026-08-31

## Context

`t()` substituted `{name}` and nothing else. Choosing between `1 file` and
`2 files` had to happen at the call site:

```tsx
{count === 1 ? t('file') : t('files')}
```

That is correct for English and wrong for most other languages. Russian has
three forms and returns 21 to the singular; Arabic has six, with a separate one
for exactly two; Persian counts zero as singular. Worse than being wrong, it is
wrong in a place the translator cannot reach: they are given a JSON file, and
the rule lives in a TSX file, in a language they may not read.

Every competing library solves this with ICU MessageFormat. The question was not
whether to do it but where the rules should live and what they should cost.

## Decision

### 1. The message chooses the arm; the runtime supplies the category

`{count, plural, one {# file} other {# files}}`, plus `selectordinal` and
`select`, parsed and rendered by the Rust core.

Which category a number falls into is **not** computed in Rust. Every JavaScript
runtime this package targets — browser, Node and Edge — already ships CLDR in
`Intl.PluralRules`. The TypeScript layer calls `select()` for each numeric
parameter and passes the result across the boundary; the core decides only which
arm that category names.

The alternative was compiling CLDR's plural rules into the core. That would put
a copy of a large table into a binary that gets downloaded, to duplicate
something the download target already has. It would also be a second copy to
keep current as CLDR revises.

The cost of this split is one `Intl.PluralRules` construction per locale, cached
for the life of the process, and a `select()` call per numeric parameter.

### 2. Braces inside an arm are structural

At the top level `{{` and `}}` remain literal braces, unchanged. Inside an arm
they are not escapes: an arm that opens with a placeholder — `other {{name} won}`
— begins with two braces that are both real, and no escape rule can tell them
apart from an escaped one.

ICU resolves this by quoting with apostrophes, which turns every `don't` in a
message into a trap and would have broken existing messages. Dropping the escape
inside arms costs a literal brace in a position nobody writes one, and leaves
every message written before this change rendering identically.

### 3. Three error codes, not one

`PLURAL_NOT_NUMERIC` (301) and `NO_MATCHING_ARM` (302) join `PARAM_MISSING`
(300). "You forgot to pass `count`", "you passed it but it was a word" and "your
message has no `other`" are three different mistakes with three different fixes,
and one code would have made the reader guess which.

A message that cannot select an arm still renders — through `other` where there
is one, and as `{count}` where there is not. A sentence with one odd plural
beats a hole where a sentence should be.

### 4. Formatting is `Intl`, and lives outside the core

`getFormatter()` / `useFormatter()` wrap `Intl.NumberFormat`,
`Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, `Intl.ListFormat` and
`Intl.Collator`. None of it enters the WebAssembly binary, so a page that
formats dates and prices but translates nothing on the client downloads no
binary at all — asserted in `test/tree-shaking.test.ts`.

This is also why the Persian calendar comes free: `Intl.DateTimeFormat('fa-IR')`
resolves to it without being asked, so a Jalali date needs no dependency.

## What it cost

The browser binary went from **55.7 KB to 63.1 KB gzip**, and its budget was
re-baselined from 60 to 68 with the reasoning recorded beside it in
`scripts/build-wasm.mjs`. The node binary went from 93.9 to 100.6 KB; it is read
from disk and never downloaded.

A first version of the parser was **13.3 KB gzip worse again**, entirely because
`same_number` compared `=0` against `0` through `str::parse::<f64>`. Rust's
string-to-float conversion is a large algorithm, and linking it to answer that
question cost more than a fifth of the whole package. It is compared as digits
now, which is both smaller and exact.

Parsing was measured before and after, best-of-three with compilation separated
from the run: `interpolate` 614.6 ns → 558.5 ns, `tokenize` 1.597 µs → 1.690 µs.
The first arrangement tried the argument parser before the placeholder parser
and cost 11% on messages containing no arguments at all; the cheap check goes
first, which is safe rather than lucky — an argument header always contains
`, keyword, `, and `is_identifier` rejects commas and spaces.

## Consequences

- `t` selects its arm inside the core; `t.rich` selects one in TypeScript,
  because a rich parameter may be a React element and cannot cross the boundary.
  Two implementations of one rule. `plural.test.tsx` renders the same messages
  through both and asserts they agree, and the core's `both_renderers_agree`
  property does the same for its own two paths over 4096 generated templates.
- `#` is only special inside a plural arm. Existing messages containing `#` are
  untouched, which is asserted rather than assumed.
- `Intl` construction is cached per locale and per option set. A malformed
  locale tag makes every `Intl` constructor throw; that is caught once, cached,
  and the message falls to `other` — reported, never silently substituted with
  another language's grammar.

## Alternatives rejected

**Compile CLDR into the core.** Duplicates what the runtime has, in the binary
that is downloaded.

**Adopt ICU's apostrophe quoting.** Breaks every message containing an
apostrophe, which in English is most of them.

**Resolve arms in Rust for `t.rich` too.** Would have removed the second
implementation, but the tokeniser would then need the parameters, and a rich
parameter can be a React element. The cross-boundary agreement test buys the
same safety without reshaping the contract.

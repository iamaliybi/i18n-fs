# Errors and fallbacks

**Behaviour is uniform. Diagnosis is not.** Every failure renders the same way,
and every failure tells you something different about why.

## What a reader sees

1. the string you passed as `options.fallback`, if you passed one;
2. otherwise the key itself.

That is the whole list. **There is no cross-language fallback**, and no way to
enable one.

```ts
t('cta.label', {}, { fallback: 'Get started' });  // "Get started"
t('cta.label');                                    // "cta.label"
```

### Why not fall back to another language

Because it produces a page that looks fine to you and is broken for the reader.
A Persian page with three English sentences in it passes every review by
somebody who reads English — and the gap never surfaces, because nothing is
missing any more. The reader gets a language they may not speak, silently.

Falling back to the key is uglier and honest: it shows up in a screenshot, in a
test, and in the console. And `i18n-fs check` turns it into a build failure
before it ships at all.

## What you see

Numbers, so code can branch on them:

```ts
import { ErrorCode, errorCodeName, isNamespaceError, isLookupError } from 'i18n-fs';
```

| code | name | meaning |
| --- | --- | --- |
| `100` | `NAMESPACE_NOT_FOUND` | the file could not be loaded — missing, 404, unreadable |
| `101` | `INVALID_JSON` | it loaded but does not parse |
| `200` | `SCOPE_NOT_FOUND` | the file parsed; the scope object is absent |
| `201` | `KEY_NOT_FOUND` | the scope exists; the key does not |
| `202` | `TYPE_MISMATCH` | the key exists but holds the wrong shape |
| `300` | `PARAM_MISSING` | a `{placeholder}` had no matching parameter |
| `400` | `INVALID_CONFIG` | the configuration is not internally consistent |

The ranges are meaningful, so a class of problem is one comparison away:

| range | meaning | helper |
| --- | --- | --- |
| `1xx` | the namespace could not be used at all | `isNamespaceError(code)` |
| `2xx` | the namespace is fine; the lookup inside it is not | `isLookupError(code)` |
| `3xx` | the message resolved; formatting it went wrong | |
| `4xx` | the configuration is wrong | |

Worth acting on differently: a missing file is one problem to fix, a missing key
is one problem per key.

```ts
try {
	store.resolveText('hero', 'title');
} catch (error) {
	if (error.code === ErrorCode.KeyNotFound) { … }
	if (isNamespaceError(error.code)) { … }
}
```

New codes may be added. Existing ones are never renumbered.

## Diagnostics

```
[i18n-fs] KEY_NOT_FOUND (201): key "cta.label" does not exist in "home/hero" for locale "fa". Falling back to the developer-supplied string, or the key itself. i18n-fs never falls back to another locale.
```

The **name** is printed beside the number, because a console is read by people
and `201` alone would send you to a table. `INVALID_JSON` carries the parser's
own line and column.

**Development only.** A production page should not narrate its content gaps to
whoever opens the console. Controlled by `debug`, which defaults to
`process.env.NODE_ENV !== 'production'`.

**Each distinct problem is logged once per process**, not once per render. A
missing key in a component that re-renders on every keystroke would otherwise
fill the console and hide everything else.

## Failures never take the page down

Nothing in the lookup path throws at a component:

- a missing or malformed **file** resolves to a failed state and degrades per
  key, so one bad file does not blank a page;
- on the client, the suspended promise **never rejects**, so a missing namespace
  does not need an error boundary;
- `t.array` returns a single-element array, so `.map()` still works.

The one thing that does throw is a version mismatch between the JavaScript and
the compiled core — the two encode the same routing and resolution rules, so a
mismatch would produce quietly *wrong* output rather than an error. That is the
one case where stopping is better than continuing.

## Catching gaps before they ship

```bash
npx i18n-fs check
```

Compares every locale against the default one by key **and by shape**, reports
invalid JSON with line and column, and exits non-zero. This is what makes the
no-cross-language-fallback rule survivable in practice — without it, a key
missing from one locale is invisible until a reader of that locale opens the
page.

Run it in CI. See [the CLI guide](./cli.md).

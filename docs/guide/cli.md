# The CLI

```bash
npx i18n-fs check     # validate; exit non-zero on any error
npx i18n-fs build     # the same checks, then write .i18n-fs/
```

## `check`

The reason this exists: `i18n-fs` never falls back to another language, so a key
missing from one locale is invisible until a reader of that locale opens the
page. `check` turns that into a build failure.

It reports:

- **invalid JSON**, with the parser's line and column
- **missing keys**, compared against the default locale
- **shape mismatches** — a key that is a string in one language and a list in
  another. A name-only comparison passes this, and then `t.array` breaks for the
  readers of exactly one language.
- **extra keys** a non-default locale defines (a warning — unreachable through
  typed lookups, but harmless)
- **missing or unknown locale directories**
- **an invalid configuration**, with the field path

```
error  KEYS_MISSING  en/home/hero is missing 3 key(s) that "fa" defines. (public/locales/en/home/hero.json)
         hero.bullets
         hero.cta.label
         hero.title

error  KEY_SHAPE_MISMATCH  en/home/hero has 1 key(s) of a different shape. (public/locales/en/home/hero.json)
         hero.bullets is list in fa, text here

2 error(s)
```

Each problem is reported **once, at its shallowest point**. A file that fails to
parse does not also produce a missing-key finding for every key it contains, and
a locale missing an entire list reports the list rather than the list plus every
index in it.

### The default locale is the reference

Everything is compared against `defaultLocale`. It defines what keys exist;
every other locale has to match. That is also where the generated types come
from — generating from the union of all locales would type keys that are missing
exactly where they are used.

### When the locales are not translations of one another

The comparison assumes every locale says the same things in different words.
Sometimes that is false by design: a site whose German pages are written for a
German audience, not translated from the English ones, has different keys and
there is nothing wrong with it.

```ts
export default defineConfig({
	locales: ['en', 'de'],
	defaultLocale: 'en',
	compareLocales: false,
});
```

With it off, no comparison between locales is reported at all — not as an error
and not as a warning. Everything that is a statement about a single file still
is: malformed JSON, an empty namespace, a directory for a locale that is not
configured.

It also changes what `build` generates. With the comparison on, the typed
registry comes from the default locale, because `check` is what guarantees the
others match it. With it off there is no such guarantee, so the registry is the
**union of every locale** — otherwise a key that exists only in German would not
compile, which would make the option useless to the projects that need it.

The trade is worth stating plainly: under the union, a key present only in
German type-checks on a page rendered in English. At runtime it falls back the
way any missing key does — the developer's string or the key itself, reported as
`KEY_NOT_FOUND`, never filled in from another language.

To see the differences once without changing the file:

```bash
npx i18n-fs check --compare-locales
```

## `build`

Runs the same checks, then writes:

| file | purpose |
| --- | --- |
| `.i18n-fs/config.mjs` | the resolved config, for your proxy and the server layer |
| `.i18n-fs/manifest.json` | a content hash per namespace |
| `.i18n-fs/messages.d.ts` | the typed key registry |

**It refuses to write when `check` finds an error.** A manifest and types
generated from a broken tree describe something that does not exist.

Output is deterministic — sorted keys, stable formatting, byte-identical on a
repeat run.

### Why the hashes

Files under `public/` are served verbatim and are not fingerprinted, so
`/locales/fa/home.json` cannot be cached immutably on its own. The manifest lets
the client request `?v=<hash>`, which changes when the content does.

Without a manifest the client still works — it fetches unversioned URLs, which
simply are not immutably cacheable.

## Options

| flag | effect |
| --- | --- |
| `--cwd <dir>` | project root (default: the current directory) |
| `--config <file>` | config file, relative to `--cwd` |
| `--out <dir>` | output directory for `build` (default: `.i18n-fs`) |
| `--strict` | treat warnings as errors |
| `--compare-locales` | compare the locales whatever the config says |
| `--no-compare-locales` | skip that comparison for this run |
| `--json` | emit findings as JSON |
| `-h`, `--help` | usage |

Exit code is `0` when there are no errors and `1` otherwise — including when the
config cannot be read at all.

## In your project

```json
{
	"scripts": {
		"dev": "i18n-fs build && next dev",
		"build": "i18n-fs build && next build",
		"lint:i18n": "i18n-fs check --strict"
	}
}
```

In CI, run `check --strict` on its own so a missing translation fails the same
way a type error does:

```yaml
- run: npx i18n-fs check --strict
```

`--json` gives the same findings as the text output, from the same analysis
pass, so tooling and humans cannot disagree about what was found.

## Requirements

Node 22.18 or newer. That is the version that reads a TypeScript config file
without a bundler, which is why the CLI has no dependencies at all. If you are
on an older Node, rename the config to `i18n-fs.config.mjs` and it will load.

<!-- nav:start -->

---

| | | |
| :-- | :--: | --: |
| ← [The proxy](./proxy.md) | [All guides](../README.md) | [Errors and fallbacks](./errors.md) → |

<!-- nav:end -->

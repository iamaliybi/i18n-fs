---
'i18n-fs': minor
---

`compareLocales`, for projects whose locales are not translations of one another.

`i18n-fs check` compares every locale against the default one and reports a
missing key as an error. That is the right default — this package never falls
back to another locale's content, so a key missing from one language is
invisible until somebody reading that language hits the page.

It assumes the locales say the same things in different words, and sometimes
that is false by design. A site whose German pages are written for a German
audience rather than translated from the English ones has different keys, and
there is nothing to report:

```ts
export default defineConfig({
	locales: ['en', 'de'],
	defaultLocale: 'en',
	compareLocales: false,
});
```

With it off, nothing about the differences between locales is reported — not as
an error, not as a warning. Everything that is a statement about a single file
still is: malformed JSON, an empty namespace, a directory for a locale that is
not configured.

It also changes what `build` generates. With the comparison on, the typed
registry comes from the default locale, because `check` is what guarantees the
others match it. With it off there is no such guarantee, so the registry is the
union of every locale — otherwise a key existing only in German would not
compile, which would make the option useless to the projects that need it. Under
the union a German-only key type-checks on an English page and falls back at
runtime the way any missing key does, reported as `KEY_NOT_FOUND` and never
filled in from another language.

`i18n-fs check --compare-locales` runs the comparison whatever the config says,
for seeing the differences once without editing the file;
`--no-compare-locales` does the opposite.

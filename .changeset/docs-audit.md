---
'i18n-fs': patch
---

An audit of the documentation against the code, and the one type that was wrong.

`t.rich` accepts a React element as a parameter — the runtime has always substituted after tokenising, precisely so an element stays an element — but the public type said `string | number`, so the documented example did not type-check. The test that claimed to cover it passed the string `'Ali'`. `RichTranslationParams` now types it, and the test passes an actual element.

Corrections where the documentation described behaviour the code does not have:

- **Suspension.** "A namespace in `namespaces` does not suspend at all" was wrong. `useTranslation` reads the WebAssembly core through `use()` before it looks at the namespace, so the *first* Client Component to translate anything waits for the core regardless. Pre-loading removes the fetch, not the suspension — and a reader following the old text would omit the boundary the first render needs.
- **Failed loads in development.** The table said a server-side failure lasts "until the file changes". It is not cached in development at all, so it is retried on the next render.
- **The sample console line** in the errors guide carried two sentences the reporter has never printed.
- **The architecture notes** described `bundler`/`nodejs` wasm-pack targets, a two-loader interface, cargo features from before routing became one, and an entry-point table without `i18n-fs/proxy`.
- `CONFIG_DEFAULTS` and `I18nClientProvider` are exported and were documented nowhere.
- The module comment shipped in `src/index.ts` still said the React layers would "land in later pull requests".

The doc checker now also compares the sample console line against the reporter, since that one drifted because nothing was watching it.

No behaviour changed.

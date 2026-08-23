---
'i18n-fs': patch
---

Prove, and keep proving, that you pay only for what you import.

Tree-shaking already worked — `sideEffects: false` is declared and bundlers honour it — but nothing in the repository would have noticed if that stopped being true. The only symptom of a regression is a larger download, which no type checker and no runtime test can see.

Measured by bundling one import at a time: `ErrorCode`, `VERSION` and `defineConfig` cost under a kilobyte; `Link`, `useRouter`, `usePathname`, `useLocaleSwitcher`, `useLocale` and `useI18nContext` cost one to two kilobytes and carry **no WebAssembly at all**; only `useTranslation` and the core loaders pull the binary, because resolving a message needs it.

Confirmed through a real Next.js build too: an app that navigates and switches locale on the client, but translates only in Server Components, emits no `.wasm`.

`test/tree-shaking.test.ts` now bundles each import and fails if one starts pulling the core, or if the side-effect declaration disappears. Verified by making `useLocale` depend on the core: the test fails by name.

The README states the guarantee where a reader deciding on a dependency will see it.

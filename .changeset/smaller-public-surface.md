---
'i18n-fs': minor
---

The public surface now matches the documentation, and navigation has one home.

Both layer entries exported roughly twice what the guide describes. `i18n-fs/server` offered `clearMessageCache`, `resetI18nConfig`, `resetReporter`, `resolveLocaleFromRequest`, `isSafeNamespace`, `namespacePath`, `readLocaleManifest` and `getRequestLocale`; `i18n-fs/client` offered `loadClientNamespace`, `stateFromPayload`, `seedNamespace`, `hasNamespace`, `clearNamespaceCache`, `namespaceUrl`, `prefetchNamespace` and `resetClientReporter`. They are the machinery behind `getTranslation` and `useTranslation`, not an API — the tests import them from source and nothing outside the package ever called them — but every one was a promise kept under semver. They are internal now.

The four lower-level loaders the guide documents for tooling — `loadNamespace`, `loadNamespaces`, `readRawNamespaces`, `readManifest` — stay.

**`<Link>`, `useRouter`, `usePathname` and `useLocaleSwitcher` are now only in `i18n-fs/navigation`.** They were in `i18n-fs/client` as well, which left two import paths for one thing. If you import them from `i18n-fs/client`, change the path to `i18n-fs/navigation`; nothing else changes. `useLocale`, `useTranslation`, `usePrefetch` and `useI18nContext` stay in `i18n-fs/client`.

The single React context that made the old arrangement necessary is preserved: `i18n-fs/navigation` now carries the implementation and reaches the context through `i18n-fs/client`, so there is still exactly one context module. A second one is what produced "No I18nProvider found" on a page that plainly had one, so it is asserted twice — CI counts `createContext` in the built entry, and a test pins every entry's exports so an accidental export fails as loudly as a missing one.

`usePrefetch` was documented under `i18n-fs/server`. It is a client hook and is now documented where it lives.

The README's size table now reports only the WebAssembly binary. It used to add every JavaScript chunk that mentioned it, which attributed the example app's own pages to this package — and the figure moved when the example changed, which is how the mistake surfaced.

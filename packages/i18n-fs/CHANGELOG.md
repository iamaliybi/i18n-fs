# i18n-fs

## 0.1.0

### Minor Changes

- c4695f7: First release.

  Folder-based internationalisation for Next.js, with locale negotiation, route
  canonicalisation, message resolution and rich-text parsing written in Rust and
  compiled to three WebAssembly binaries — one per runtime, so the Edge middleware
  carries only what middleware needs.

  - **`i18n-fs/server`** — `getLocale`, `getTranslation`, `I18nProvider`
  - **`i18n-fs/client`** — `useTranslation`, `useLocale`
  - **`i18n-fs/navigation`** — `Link`, `useRouter`, `usePathname`, `useLocaleSwitcher`
  - **`i18n-fs/middleware`** — `createI18nMiddleware`
  - **`i18n-fs`** (bin) — `i18n-fs check` and `i18n-fs build`

  Two things worth knowing before you adopt it:

  - **A missing translation never falls back to another language.** It falls back
    to the string you supply, or to the key, and tells you in the console exactly
    which of "file missing", "invalid JSON", "scope absent", "key absent" or
    "wrong shape" happened. `i18n-fs check` turns those into build failures.
  - **Routing is loop-safe by construction.** Canonicalisation is idempotent and
    redirects preserve the locale that was asked for; both are asserted by
    property tests over thousands of generated cases, and again end-to-end against
    a real Next.js server.

  Requires Node 22.18 or newer.

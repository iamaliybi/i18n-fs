---
'i18n-fs': patch
---

Complete documentation.

Seven guides under `docs/guide/`: getting started, folder structure,
translating, routing, the proxy, the CLI, errors, and a full API reference by
entry point.

The gaps this closes:

- **`app/[locale]/` was never mentioned.** It is required in every prefix mode
  including `never`, because the proxy always rewrites to a locale-prefixed
  internal path even when the URL shows none.
- **`t.array`, `t.rich`, `t.has` and `t.raw`** each have a section now, rather
  than a line in a list.
- **Routing strategies** are explained with their trade-offs, not just named.
- **The proxy** has a guide covering the Next.js 16 rename, the matcher's
  double-backslash trap, composition and troubleshooting.

`README.md` now leads with what actually distinguishes the package rather than
with a fallback policy.

`pnpm check:docs` verifies every relative link resolves, every documented export
exists in the built declarations, no documented name has been renamed away, and
the error code table matches the source. It runs in CI.

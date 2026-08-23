---
'i18n-fs': minor
---

The browser binary is 38% smaller: 55.7 KB gzip, down from 89.9 KB.

It was carrying locale negotiation, route canonicalisation and config validation — none of which a browser ever executes. `<Link>` and `usePathname` are answered by a TypeScript mirror of the same rules so they can stay synchronous, and every redirect decision is made by the proxy before the page is served. That was 34 KB gzip on every visit, for code that never ran.

Routing is now a cargo feature, and each of the three binaries names exactly what it needs: the proxy gets routing, the browser gets messages, the server gets both. Every build passes `--no-default-features`, so a feature added later cannot quietly land in the binary a visitor downloads.

| binary | before | after |
| --- | --- | --- |
| browser (downloaded by visitors) | 89.9 KB gzip | **55.7 KB gzip** (47.8 KB brotli) |
| edge (runs on every request) | 60.4 KB gzip | unchanged |
| node (read from disk) | 93.6 KB gzip | unchanged |

Nothing is downloaded at all by a page that translates only in Server Components — the browser binary is fetched lazily, and only when a Client Component calls `useTranslation`.

`loadMessageCore()` is new and is what a Client Component should reach for. `loadFullCore()` now means both halves, which only the Node binary has, and rejects elsewhere with a message naming the right loader; `loadCore()` rejects in the browser for the same reason. If you only use `useTranslation`, `getTranslation` and the navigation wrappers, nothing changes.

---
'i18n-fs': minor
---

Message files now hot-reload in development, failed loads say what clears them, and lookups no longer allocate.

Editing a translation while the dev server ran did nothing visible. Message files live under `public/`, so changing one reloads no module and Next.js had nothing to re-run — the server kept serving its cached copy until it was restarted, and the browser kept serving its own. The server now compares the file's timestamp before trusting its cache, and the client fetches with `cache: 'no-store'`, both only in development. Production stats nothing: the files cannot change under a running build.

A failed load is still remembered rather than retried, because a re-render is not evidence that a missing file has appeared and retrying per render would turn one 404 into a stream. What was missing is that nothing said so, so a transient failure looked like a permanent bug. Each diagnostic now names what clears it: fix the file (server, development), restart (server, production), reload the page (client).

Lookups were building a string on every call — `format!("{scope}.{key}")` when scoped, a copy of the key when not. Both are gone: an unscoped lookup hashes the caller's key as it stands, and a scoped one joins on the stack. Measured on the same machine, scoped resolution is 58% faster and unscoped 50%.

No API changed.

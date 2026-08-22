# ADR 0002 — Message files live in `public/`

Status: accepted
Date: 2026-08-22

## Context

Translation JSON has to be reachable from three places: the server while
rendering, the browser after hydration, and the CLI at build time. The project
requires that the files live under `public/`, with the folder layout beneath it
left entirely to the developer.

## Decision

Messages live at `public/<messagesDir>/<locale>/<namespace>.json`, where
`messagesDir` defaults to `locales`. The namespace is the path beneath the
locale directory, so `useTranslation('home/hero', 'cta')` reads
`public/locales/fa/home/hero.json` and looks up the `cta` object inside it.

How they are read depends on where the code runs, because the cheapest correct
answer differs:

- **Server (Node)** — read from `process.cwd()/public/...` with `fs`. A Server
  Component fetching its own origin over HTTP to read a local file is a wasted
  round trip.
- **Browser** — `fetch('/locales/<locale>/<ns>.json?v=<hash>')`.
- **Edge** — never. Middleware resolves the locale and nothing else.

Both paths hand the bytes to the same Rust store, so resolution and error
reporting cannot drift between server and client.

### Cache busting

Files under `public/` are served as-is and are not fingerprinted by Next.js, so
they cannot be cached immutably on their own. The CLI emits a manifest of
content hashes and the client appends `?v=<hash>`, which makes the response
immutably cacheable while still changing when the content does.

## Consequences

- Translation files are publicly readable. That is inherent to `public/` and to
  anything the browser can fetch; it is worth stating so nobody puts secrets in
  a message file.
- The developer owns the folder structure. `i18n-fs` imposes no layout and no
  shared-key convention — if shared keys are wanted, the developer injects them.
  See [ADR 0003](0003-fallback-policy.md) for why the package does not invent
  structure on the developer's behalf.
- The CLI needs to run before the app to produce the manifest.

# i18n-fs documentation

## Guides

The guides are written to be read in this order, and each one links to the next,
so you can start at the top and keep going. Every page also links back here.

| | |
| --- | --- |
| [Getting started](guide/getting-started.md) | nothing to a translated page, in nine steps |
| [Folder structure](guide/folder-structure.md) | what is required, what is yours, and why `[locale]` is not optional |
| [Translating](guide/translating.md) | `t`, `t.array`, `t.rich`, `t.has`, `t.raw` |
| [Routing](guide/routing.md) | strategies, prefixes, navigation, switching language |
| [The proxy](guide/proxy.md) | setup, the matcher, composing, Next.js 16 |
| [The CLI](guide/cli.md) | `check`, `build`, CI |
| [Errors](guide/errors.md) | codes, fallbacks, diagnostics |
| [API reference](guide/api.md) | every export, by entry point |

## How it is built

[ARCHITECTURE.md](ARCHITECTURE.md) describes the pieces and how they fit.

Every non-obvious decision is written down, with what it cost and what was tried
first:

| ADR | subject |
| --- | --- |
| [0001](adr/0001-wasm-boundary.md) | where the Rust/WASM boundary sits, and what it measures |
| [0002](adr/0002-messages-in-public.md) | why messages live in `public/` and how they are cached |
| [0003](adr/0003-fallback-policy.md) | uniform fallback, distinct diagnosis |
| [0004](adr/0004-loop-prevention.md) | preventing redirect loops, and the three bugs property tests found |
| [0005](adr/0005-config-snapshot.md) | compiling the config into a snapshot |
| [0006](adr/0006-cli.md) | the CLI, and why most of it is not Rust |
| [0007](adr/0007-server-layer.md) | the server layer and the server/client boundary |
| [0008](adr/0008-client-layer.md) | suspension, and why the promise cache is module-scoped |
| [0009](adr/0009-middleware-and-navigation.md) | the proxy, navigation, and where the WASM actually loads |
| [0010](adr/0010-package-manager.md) | npm workspaces, not pnpm |

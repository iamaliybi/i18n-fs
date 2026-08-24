---
'i18n-fs': patch
---

A release build warned that a function was unused, and nothing had ever checked the combination it was unused in.

`cargo clippy --all-features` compiles a configuration nobody runs: every helper has a caller there, so nothing looks dead. The Edge binary is built with `--features routing` alone, and in that build the serde helpers had no callers after the primitive-boundary change. The first thing to notice was `npm run release`.

CI now lints each of the three feature sets that are actually built — `routing`, `full`, and `full,cli,routing` — and the helpers are gated to match their real callers rather than carrying `#[allow(dead_code)]`. Allowing dead code is what let the compiler be right and silent at the same time.

Removing that dead code took the Edge binary from 38.3 KB to **37.8 KB** gzip, which was not the point but is welcome.

`wasm-pack` also warned on every build that the crate had no licence file beside it. `scripts/build-wasm.mjs` copies the repository's own, rather than committing a second copy that could drift from the first.

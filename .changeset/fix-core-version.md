---
'i18n-fs': patch
---

Report the real package version.

`coreVersion()` returned `0.0.0` in 0.1.0 — the Rust crate's version, which is
never published and never moves — while the package was `0.1.0`. Two doc
comments claimed the JavaScript asserted the two agreed; nothing did.

The npm version is now stamped into each WebAssembly binary at build time, and
the loader compares it against the version compiled into the JavaScript,
refusing to start when they differ. The two halves encode the same routing and
resolution rules, so a stale `wasm/` directory would apply the old ones while
the JavaScript applied the new — producing wrong output rather than an error.

Also adds a `VERSION` export, which is what you want in a bug report.

---
'i18n-fs': minor
---

The Edge binary is 37% smaller: 38.3 KB gzip, down from 60.4 KB.

It carried `serde-wasm-bindgen` in order to deserialise the configuration on every request — roughly a third of the binary, for a value that does not change while the process lives. ADR 0001 recorded this as the known cost and the known fix; this is the fix.

Routing now crosses the WebAssembly boundary as a `Router` built once from primitives — plain strings, numbers and booleans — which then answers questions. `serde` is not compiled into the Edge binary at all. That is asserted rather than assumed: the surface test decodes the embedded bytes and fails if serde's own error strings appear in them.

This matters more than the browser reduction that preceded it. The browser binary is downloaded once per visitor; this one is instantiated on **every request**.

The exported WebAssembly surface changed, so `EdgeCore` did too: the five free functions are gone and `Router` replaces them, reached through `loadRouter(config)`. `Decision` is flat now — `action` is `'next' | 'rewrite' | 'redirect'` with `path` and `permanent` beside it, rather than a tagged union, because a union would have to cross as a serialised object. Nothing in the public API of the package changed; `createI18nProxy`, `getTranslation` and the hooks are untouched.

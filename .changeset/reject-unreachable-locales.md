---
'i18n-fs': patch
---

`i18n-fs check` now rejects a locale that can never be selected.

A domain may opt into serving extra locales — `{ domain: 'example.com', locale: 'en', locales: ['de-AT'] }` — and those are reachable only through a URL prefix, which is what opting in means. Pairing that with `prefix: 'never'` asks for something impossible: the prefix is removed, so `de-AT` is declared and unreachable.

Nothing broke, which is why this needed catching rather than fixing. The router resolves it deterministically and does not loop — that is covered by the property tests — so the only symptom was a page rendering in the wrong language with nothing to explain why. It is now an `INVALID_CONFIG` at build time, naming the domain and saying what to use instead.

Recorded as future work in ADR 0004 when the loop-prevention work found it; the ADR is updated.

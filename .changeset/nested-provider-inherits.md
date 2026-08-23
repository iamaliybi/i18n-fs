---
'i18n-fs': minor
---

A nested `<I18nProvider>` now extends the one above it instead of replacing it.

Putting a provider on a route rather than at the root is a real size optimisation — a dashboard can ship six namespaces to nobody but the dashboard. Until now the inner provider replaced the context, so it had to re-list every namespace its parent already sent, and forgetting one did not fail: the namespace was fetched over the network instead, the same bytes the server had already inlined into the HTML. During server rendering that fetch has no origin, so the component rendered its fallback and filled in after hydration.

An inner provider now lists only what its section adds. Naming the same namespace in both is still allowed and the inner one wins, which is how a section ships its own copy of a shared namespace.

Inheritance stops at a change of locale: a provider whose locale differs from the one above it starts from nothing, because handing one locale's messages to the other's subtree would be worse than making it list them again.

The README now carries what the choice costs, measured on three namespaces of 13.5 KB each: 13.0 KB over the wire with `namespaces`, 2.2 KB with `prefetch`, 2.0 KB with neither. Minifying the JSON is not worth doing — 3% smaller on disk, 0.1 KB after gzip.

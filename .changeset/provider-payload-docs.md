---
'i18n-fs': patch
---

Say what `namespaces` actually does, and what happens when providers nest.

`namespaces` and `prefetch` were easy to read as two spellings of the same idea. They are opposites. `namespaces` **serialises the JSON into the HTML** — nothing to wait for, and every visitor carries those bytes whether or not the component that reads them renders. `prefetch` emits a `<link rel="preload">` and adds nothing to the document. The guides now say the first part in those words instead of "the payload grows".

Nesting a provider is documented for the first time, along with the surprise in it: an inner provider **replaces** the context rather than extending it, so it must list every namespace its subtree reads — including ones the outer provider already sends. Leaving one out still renders, which is what makes it worth stating: the namespace is fetched over the network instead, the same file the server already inlined into the HTML, and during server rendering that fetch has no origin so the component renders its fallback.

Two tests pin both halves of that: the fetch that happens when the inner provider omits a namespace, and the fetch that does *not* happen when something above already read it.

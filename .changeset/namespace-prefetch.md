---
'i18n-fs': minor
---

Prefetching, so a Client Component does not wait for its namespace.

Until now there were two settings: name a namespace in `<I18nProvider namespaces>` and it is inlined into the HTML for every visitor whether or not it is read, or leave it out and the browser starts fetching only after hydration. This adds the middle.

`<I18nProvider prefetch={['settings/panel']}>` emits a `<link rel="preload">`. The request goes out with the HTML, in parallel with the JavaScript, and the payload does not grow. Use it for a client-only subtree or a panel that opens shortly after the page settles.

`usePrefetch()` starts the request on intent instead, which costs nothing for visitors who never open the thing:

```tsx
const prefetch = usePrefetch();
const warm = () => prefetch('settings/panel');

<button onPointerEnter={warm} onFocus={warm} onClick={open}>Settings</button>
```

`onFocus` as well as `onPointerEnter`, because a keyboard user never hovers and a touch user has no hover at all.

**A failed prefetch is forgotten.** A failed read is remembered, so one 404 does not become a request per render — but a prefetch is a guess, and caching a failed guess would let a moment of bad network decide that a namespace is missing for the rest of the page's life. The component that actually needs it would render fallbacks having never tried.

Verified in a browser on both example apps: the preload is reused rather than re-downloaded, the panel opens without suspending, and the console is clean. The `crossorigin` attribute is required for that even though the request is same-origin — without it the browser downloads the file twice, which is how the first attempt was caught.

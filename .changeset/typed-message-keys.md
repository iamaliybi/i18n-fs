---
'i18n-fs': minor
---

The generated key registry is now connected to `t`. A mistyped key is a compile error, which the README has claimed since 0.1.0 and which was not true.

`i18n-fs build` has always written `.i18n-fs/messages.d.ts` listing every namespace, scope and key, and it has always been accurate. Nothing read it. `getTranslation` took a `string`, `t` took a `string`, and `t('titel')` compiled — for six published versions, while the README promised otherwise.

`getTranslation` and `useTranslation` are generic over that registry now, so all of these fail to compile:

```ts
const t = await getTranslation('home/hero', 'hero');

t('titel');          // not assignable to '"title"'
t.array('title');    // 'title' is text, not a list
t('bullets');        // 'bullets' is a list, not text

await getTranslation('home/heroo');        // no such namespace
await getTranslation('home/hero', 'heor'); // no such scope
```

A scope with no lists at all reports `this scope has no list keys` rather than a message about `never`.

**Nothing breaks in a project that has not run `i18n-fs build`**: with an empty registry every namespace, scope and key is accepted, exactly as before. `Translator` written without type arguments still means "any key", so existing annotations keep working.

**`unknownKey` is new**, for the two cases a union cannot describe: a key assembled at runtime, and a key you know is absent. It does nothing at runtime — a function rather than `as never` so the intent stays visible in a diff.

One line of setup, which the guide already documented and the example apps did not follow: `.i18n-fs/**/*.d.ts` has to be named in `tsconfig.json`, because TypeScript skips directories beginning with a dot. Without it every key is `string` again.

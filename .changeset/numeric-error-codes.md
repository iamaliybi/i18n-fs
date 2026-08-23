---
'i18n-fs': minor
---

Error codes are numbers you can import, and the proxy has its Next.js 16 name.

**Breaking.** `error.code` was a string like `'KEY_NOT_FOUND'`; it is now a
number, and `ErrorCode` is a value you import rather than a type you can only
annotate with:

```ts
import { ErrorCode, errorCodeName, isLookupError } from 'i18n-fs';

if (error.code === ErrorCode.KeyNotFound) { … }
```

Codes are grouped so a whole class of problem is one comparison away — `1xx`
the namespace could not be used, `2xx` the lookup inside it failed, `3xx`
formatting, `4xx` configuration — with `isNamespaceError` and `isLookupError`
for the common cases. Diagnostics print the name beside the number, because a
console is read by people.

**`createI18nProxy`.** Next.js 16 renamed the file convention from `middleware`
to `proxy` and deprecated the old name. `createI18nProxy` and the
`i18n-fs/proxy` entry point match it; `createI18nMiddleware` is the identical
function and still exported, so upgrading Next.js does not force two changes at
once.

**`withI18nFs` is deprecated and now returns your config untouched.** It enabled
a webpack experiment the package no longer needs, and Next.js 16 rejects a
project that has a `webpack` config and no `turbopack` config — so calling it
broke the build. **No `next.config` changes are needed at all**, verified on
Next.js 15 with `middleware.ts` and Next.js 16 with `proxy.ts`.

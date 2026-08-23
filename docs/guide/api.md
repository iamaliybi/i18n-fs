# API reference

Six entry points, split by where the code runs. Importing `i18n-fs/server` from
a Client Component is a build error, which is the intent.

| entry | runs where |
| --- | --- |
| [`i18n-fs`](#i18n-fs) | anywhere |
| [`i18n-fs/server`](#i18n-fsserver) | Server Components, Route Handlers, Server Actions |
| [`i18n-fs/client`](#i18n-fsclient) | Client Components |
| [`i18n-fs/navigation`](#i18n-fsnavigation) | Client Components |
| [`i18n-fs/proxy`](#i18n-fsproxy) · `i18n-fs/middleware` | `proxy.ts` / `middleware.ts` |
| [`i18n-fs/config`](#i18n-fsconfig) | `i18n-fs.config.ts` |

---

## `i18n-fs`

### `ErrorCode`

A frozen object of numbers. See [errors](./errors.md).

```ts
ErrorCode.NamespaceNotFound  // 100
ErrorCode.InvalidJson        // 101
ErrorCode.ScopeNotFound      // 200
ErrorCode.KeyNotFound        // 201
ErrorCode.TypeMismatch       // 202
ErrorCode.ParamMissing       // 300
ErrorCode.InvalidConfig      // 400
```

### `errorCodeName(code): string`

`201` → `'KEY_NOT_FOUND'`. Unknown codes give `UNKNOWN_<n>`.

### `isErrorCode(value): boolean`

Whether a value is a code this version knows about.

### `isNamespaceError(code): boolean` · `isLookupError(code): boolean`

The `1xx` and `2xx` groups.

### `ERROR_CODE_NAMES`

The full `code → name` map, frozen.

### `VERSION`

The package version. What to put in a bug report.

### `loadCore()` · `loadMessageCore()` · `loadFullCore()` · `hasMessageSupport()`

The WebAssembly core, for advanced use. There are three binaries and each
carries only what its runtime needs, so the loader you want depends on what you
are asking for:

| loader | surface | available in |
| --- | --- | --- |
| `loadCore()` | routing and negotiation | proxy, server |
| `loadMessageCore()` | messages and formatting | browser, server |
| `loadFullCore()` | both | server only |

Each rejects with a message naming the alternative when the running binary does
not carry what was asked for — `loadCore()` in a Client Component points you at
`i18n-fs/navigation`, whose `<Link>` and `usePathname` answer the same rules
synchronously without any WebAssembly at all.

`hasMessageSupport()` is true wherever messages can be resolved: the browser and
the server, not the proxy.

---

## `i18n-fs/server`

### `getTranslation(namespace, scope?): Promise<Translator>`

A translator for the request's locale. Reads the file with `fs` and caches it
per process; in development the file's timestamp is checked first, so an edit
shows up on the next render. See [translating](./translating.md).

### `getLocale(): Promise<string>`

The active locale, memoised per request.

### `getResolvedLocale(): Promise<{ locale, source }>`

The same, plus where it came from: `'override' | 'header' | 'cookie' |
'accept-language' | 'default'`. Useful when debugging why a page came out in an
unexpected language.

### `setRequestLocale(locale): void`

Pin the locale for this request. Call it in `app/[locale]/layout.tsx` under the
`path` strategy — a Server Component cannot read the pathname, so it has to be
told. Request-scoped through React's `cache()`.

### `<I18nProvider namespaces? locale?>`

A Server Component that hands the locale and the named namespaces to the client
tree. Render it in your locale layout.

`namespaces` is only for **Client** Components; Server Components load what they
need themselves. Anything a Client Component reads on first paint belongs here,
or it will render its fallback during SSR and fill in after hydration.

`prefetch` names namespaces to start downloading without putting them in the
payload: it emits `<link rel="preload">`, so the request goes out with the HTML
and the HTML does not grow. Use it for a client-only subtree or a panel that
opens shortly after the page settles. Anything already in `namespaces` is
skipped.

### `redirect(href, locale?)` · `permanentRedirect(href, locale?)`

`next/navigation`'s redirects, taking locale-free paths. Like the originals,
they never return.

### `getPathname(href, locale?): Promise<string>`

The public path for a locale-free href.

### `configureI18n(config)` · `getI18nConfig()`

Register the configuration explicitly. Rarely needed — the server imports
`.i18n-fs/config.mjs` by itself. The escape hatch for deployment layouts where
that does not resolve, and for tests.

### `loadNamespace` · `loadNamespaces` · `readRawNamespaces` · `readManifest`

Lower-level loading, exported for tooling that wants the messages without a
translator around them. Everything else behind `getTranslation` — cache resets,
path builders, the locale resolver — is internal and not exported.

---

## `i18n-fs/client`

Translation and locale state. Navigation lives in
[`i18n-fs/navigation`](#i18n-fsnavigation) — it used to be re-exported here as
well, which left two import paths for one thing and no answer to which was
right.

### `useTranslation(namespace, scope?): Translator`

The same translator as `getTranslation`, synchronously. Suspends while fetching
a namespace the server did not send — which replaces the whole subtree under the
nearest `<Suspense>` boundary, so put one close to the component that fetches.

Naming the namespace in `<I18nProvider namespaces>` removes that fetch, but not
every suspension: the **first** Client Component to translate anything also
waits for the WebAssembly core, which it reads through `use()` before consulting
the namespace. Once per page, so only the first one needs the boundary.

The result of a fetch, including a failed one, is kept until the page is
reloaded.

### `usePrefetch(): (...namespaces: string[]) => void`

Starts loading namespaces in the background, from an event handler. Never
suspends, never throws, returns nothing to await.

```tsx
const prefetch = usePrefetch();
const warm = () => prefetch('settings/panel');

<button onPointerEnter={warm} onFocus={warm} onClick={open}>Settings</button>
```

`onFocus` as well as `onPointerEnter`, since a keyboard user never hovers and a
touch user has no hover at all.

A prefetch that fails is forgotten rather than cached, so a bad moment while
guessing cannot decide the answer for the read that actually needs it. Anything
already loaded, in flight, or sent by the server is skipped.

### `useLocale(): string`

The active locale.

### `<I18nClientProvider>`

What `<I18nProvider>` renders once it has resolved the locale on the server. It
is exported because that hand-off crosses a `'use client'` boundary and so has to
be a real module — an application renders `<I18nProvider>` from `i18n-fs/server`
and never this.

### `useI18nContext()`

Locale, resolved config and the messages the server sent. Throws outside a
provider, with a message naming the fix.

---

## `i18n-fs/navigation`

### `<Link href locale? …>`

`next/link` with the active locale applied. `href` is locale-free. Anything that
is not one of your paths passes through untouched.

### `useRouter(): LocaleRouter`

`push`, `replace`, `back`, `forward`, `refresh`, `prefetch` — all taking
locale-free paths, and an optional `{ locale }`.

### `usePathname(): string`

The current path **without** its locale prefix.

### `useLocaleSwitcher(): LocaleSwitcher`

```ts
const { locale, locales, switchTo, hrefFor } = useLocaleSwitcher();
```

`switchTo` writes the cookie and performs a full page load. See
[routing](./routing.md#switching-language).

---

## `i18n-fs/proxy`

Also available as `i18n-fs/middleware`; both export both names.

### `createI18nProxy(config, options?): I18nProxyHandler`

The handler. `options.before(request)` runs first — return a response to
short-circuit. See [the proxy guide](./proxy.md).

### `createI18nMiddleware`

*Deprecated alias.* The identical function, kept because Next.js 14 and 15 use
the `middleware` file convention.

### `LOCALE_HEADER` · `RESOLVED_HEADER` · `RECOMMENDED_MATCHER`

`RECOMMENDED_MATCHER` is for documentation and tests — Next.js will not accept
an imported matcher.

---

## `i18n-fs/config`

### `defineConfig(config): I18nFsConfig`

Types your `i18n-fs.config.ts`. Does not validate — validation happens in the
CLI, where every problem can be reported at once against the real file.

| field | default | |
| --- | --- | --- |
| `locales` | — | every locale you ship, as BCP-47 tags |
| `defaultLocale` | — | routing fallback; never a content fallback |
| `strategy` | `'path'` | `'path'` · `'domain'` · `'cookie'` |
| `prefix` | `'as-needed'` | `'always'` · `'as-needed'` · `'never'` |
| `domains` | `[]` | required for the `domain` strategy |
| `cookie` | see below | `name`, `maxAge`, `sameSite`, `path`, `secure` |
| `messagesDir` | `'locales'` | directory under `public/` |
| `debug` | `NODE_ENV !== 'production'` | emit diagnostics |

Cookie defaults: `I18N_FS_LOCALE`, one year, `lax`, `/`, `secure`.

### `CONFIG_DEFAULTS`

The values `defineConfig` fills in when you leave a field out: `strategy: 'path'`,
`prefix: 'as-needed'`, `messagesDir: 'locales'`, and the cookie's name, lifetime
and flags. Read it to see what you are getting rather than to change it —
overriding a field means passing it to `defineConfig`.

### `withI18nFs(nextConfig)`

*Deprecated.* Returns the config untouched. No `next.config` changes are needed;
on Next.js 16 the old behaviour broke the build. Delete the call.

---

## `Translator`

What both `getTranslation` and `useTranslation` return. Full guide:
[translating](./translating.md).

```ts
t(key, params?, options?): string
t.array(key, params?, options?): string[]
t.rich(key, tags?, params?, options?): ReactNode
t.has(key): boolean
t.raw(key): string | string[] | undefined
```

`params` is `Record<string, string | number>`; for `t.rich` a parameter may also
be a `ReactNode`. `options` is `{ fallback?: string }` — the only fallback there
is.

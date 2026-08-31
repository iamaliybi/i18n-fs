# Folder structure

Two things live in fixed places. Everything else is yours.

```
your-app/
├── i18n-fs.config.ts          ← required, project root
├── proxy.ts                   ← required (middleware.ts on Next.js 15)
│
├── app/
│   └── [locale]/              ← required
│       ├── layout.tsx
│       ├── page.tsx
│       └── about/page.tsx
│
├── public/
│   └── locales/               ← required down to here
│       ├── fa/                ← one directory per configured locale
│       │   ├── common.json    ← below this, entirely yours
│       │   └── home/hero.json
│       └── en/
│           ├── common.json
│           └── home/hero.json
│
└── .i18n-fs/                  ← generated; commit it or ignore it
    ├── config.mjs
    ├── manifest.json
    └── messages.d.ts
```

## Why `app/[locale]/` is required

The proxy always rewrites to a locale-prefixed **internal** path, even when the
public URL has no prefix:

```
visitor sees   /about
Next.js routes /fa/about   →   app/[locale]/about/page.tsx
```

So the router needs a segment to catch the locale.

**This holds even with `prefix: 'never'`**, where the URL never shows a locale.
The rewrite is internal — the visitor does not see it, but Next.js does. This is
the single most common thing to get wrong: hiding the locale from the URL does
not remove `[locale]` from the filesystem.

There is no root `app/layout.tsx` in the tree above. `app/[locale]/layout.tsx`
renders `<html>` itself, and Next.js is satisfied because every route passes
through it.

## What the locale layout has to do

```tsx
// app/[locale]/layout.tsx
import { I18nProvider, setRequestLocale } from 'i18n-fs/server';

export default async function LocaleLayout({ children, params }) {
	const { locale } = await params;
	setRequestLocale(locale);

	return (
		<html lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
			<body>
				<I18nProvider namespaces={['common']}>{children}</I18nProvider>
			</body>
		</html>
	);
}
```

`setRequestLocale(locale)` pins the segment for this request. Under the `path`
strategy the `[locale]` segment is authoritative, but a Server Component cannot
read the pathname — so it has to be told. It is scoped to one request through
React's `cache()`, never a module variable, because a module variable would
serve one visitor another visitor's language.

Under `cookie` or `domain` you can leave it out: the locale comes from headers
the server can read by itself.

## Below the locale directory, nothing is imposed

The namespace **is** the path:

| file | namespace |
| --- | --- |
| `public/locales/fa/common.json` | `common` |
| `public/locales/fa/home/hero.json` | `home/hero` |
| `public/locales/fa/marketing/pricing/tiers.json` | `marketing/pricing/tiers` |

```ts
const t = await getTranslation('home/hero');
```

Move a file and one string changes. There is no registry to update, no import
map to keep in sync, and no central module that has to know about every message
file you own.

By default every locale is expected to hold the same files and the same keys,
and `i18n-fs check` fails the build when one does not — see
[the CLI guide](./cli.md#the-default-locale-is-the-reference). If your locales
are not translations of one another, say so with `compareLocales: false` and the
trees are free to differ.

## Shared keys

There is no convention for them, deliberately. If several namespaces need the
same strings, put them in a namespace of your own and read it where you need it:

```ts
const t = await getTranslation('home/hero');
const shared = await getTranslation('common');
```

Nothing here will merge, inherit, or fall back between namespaces on your
behalf. What you asked for is what you get.

## The generated directory

`i18n-fs build` writes `.i18n-fs/`:

| file | who reads it |
| --- | --- |
| `config.mjs` | your `proxy.ts`, and the server layer |
| `manifest.json` | the provider, for cache-busting client fetches |
| `messages.d.ts` | TypeScript |

Output is deterministic — sorted keys, stable formatting, byte-identical on a
repeat run — so committing it produces no noise. Ignoring it is equally fine as
long as `i18n-fs build` runs before `next build`:

```json
{
	"scripts": {
		"build": "i18n-fs build && next build",
		"dev": "i18n-fs build && next dev"
	}
}
```

Point TypeScript at the generated types so your keys are checked:

```json
{ "include": ["**/*.ts", "**/*.tsx", ".i18n-fs/messages.d.ts"] }
```

## Where files may not go

A namespace becomes a path under `public/`, and it is not always your code that
chooses it — a route segment or a CMS value can end up there. Absolute paths,
drive letters and any `..` segment are rejected before anything touches the
disk, so a namespace can never read outside the messages directory.

Message files are served by the web server like any other file in `public/`.
They are readable by anyone. Do not put anything in them you would not publish.

<!-- nav:start -->

---

| | | |
| :-- | :--: | --: |
| ← [Getting started](./getting-started.md) | [All guides](../README.md) | [Translating](./translating.md) → |

<!-- nav:end -->

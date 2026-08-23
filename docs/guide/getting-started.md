# Getting started

A complete Next.js App Router setup, from nothing to a translated page.

Requires **Next.js 14.2+** and **Node 22.18+**.

```bash
npm install i18n-fs
```

## 1. Configure

```ts
// i18n-fs.config.ts
import { defineConfig } from 'i18n-fs/config';

export default defineConfig({
	locales: ['fa', 'en'],
	defaultLocale: 'fa',
	strategy: 'path',
	prefix: 'as-needed',
});
```

`defaultLocale` is a **routing** fallback — the language served when nothing
else resolves. It is never a content fallback: a missing Persian string does not
become the English one. See [errors](./errors.md).

Other strategies and prefix modes: [routing](./routing.md).

## 2. Write your messages

```
public/locales/fa/common.json
public/locales/fa/home/hero.json
public/locales/en/common.json
public/locales/en/home/hero.json
```

```json
// public/locales/en/home/hero.json
{
	"hero": {
		"title": "Welcome",
		"bullets": ["Fast", "Small"],
		"cta": { "label": "Get started" }
	},
	"terms": "Please read the <link>terms</link>"
}
```

The path beneath the locale directory **is** the namespace, so this file is
`home/hero`. Organise them however you like — nothing here imposes a structure.

## 3. Generate

```bash
npx i18n-fs build
```

This validates everything and writes `.i18n-fs/`. Wire it into your scripts so
it always runs first:

```json
{
	"scripts": {
		"dev": "i18n-fs build && next dev",
		"build": "i18n-fs build && next build"
	}
}
```

And point TypeScript at the generated types:

```json
{ "include": ["**/*.ts", "**/*.tsx", ".i18n-fs/messages.d.ts"] }
```

## 4. Add the proxy

```ts
// proxy.ts          (Next.js 16+; call it middleware.ts on 14 and 15)
import { createI18nProxy } from 'i18n-fs/proxy';
import i18nConfig from './.i18n-fs/config.mjs';

export default createI18nProxy(i18nConfig);

export const config = {
	matcher: ['/((?!_next/|api/|.*\\.[^/]*$).*)'],
};
```

Two things that bite people, both silent:

- **Write the matcher out literally.** Next.js reads it by static analysis and
  rejects an imported constant.
- **Note the double backslash.** `'\.'` in a JavaScript string is just `.`,
  which makes the pattern match nothing but `/` — with no error anywhere.

No `next.config` changes are needed. More: [the proxy guide](./proxy.md).

## 5. Move your routes under `[locale]`

```
app/
└── [locale]/
    ├── layout.tsx
    ├── page.tsx
    └── about/page.tsx
```

**Required in every prefix mode**, including `never`. The proxy always rewrites
to `/[locale]/…` internally, even when the visitor's URL shows no locale. See
[folder structure](./folder-structure.md).

## 6. Render the provider

```tsx
// app/[locale]/layout.tsx
import type { ReactNode } from 'react';
import { I18nProvider, setRequestLocale } from 'i18n-fs/server';

export default async function LocaleLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
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

`setRequestLocale` pins the segment for this request, because a Server Component
cannot read the pathname.

`namespaces` lists what to send to the browser — it is for **Client** Components
only. Server Components load what they need themselves.

## 7. Translate

```tsx
// app/[locale]/page.tsx
import { getTranslation } from 'i18n-fs/server';

export default async function HomePage() {
	const t = await getTranslation('home/hero', 'hero');

	return (
		<main>
			<h1>{t('title')}</h1>
			<ul>
				{t.array('bullets').map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
			<button>{t('cta.label')}</button>
		</main>
	);
}
```

In a Client Component, the same thing without the `await`:

```tsx
'use client';
import { useTranslation } from 'i18n-fs/client';

export function Cta() {
	const t = useTranslation('home/hero', 'hero');
	return <button>{t('cta.label')}</button>;
}
```

Everything `t` can do: [translating](./translating.md).

## 8. Link and switch

```tsx
'use client';
import { Link, useLocaleSwitcher } from 'i18n-fs/navigation';

export function Nav() {
	const { locale, locales, switchTo, hrefFor } = useLocaleSwitcher();

	return (
		<nav>
			<Link href="/about">About</Link>

			{locales.map((candidate) => (
				<a
					key={candidate}
					href={hrefFor(candidate)}
					aria-current={candidate === locale ? 'true' : undefined}
					onClick={(event) => {
						event.preventDefault();
						switchTo(candidate);
					}}
				>
					{candidate}
				</a>
			))}
		</nav>
	);
}
```

`href` is locale-free, so changing your routing strategy later touches no link.

## 9. Guard it in CI

```yaml
- run: npx i18n-fs check --strict
```

Because a missing translation never falls back to another language, this is what
stops a gap in one locale reaching a reader of that locale. It compares every
locale against the default one by key **and by shape**.

## A working example

[`examples/next-app-router`](../../examples/next-app-router) is a complete app
covering all of the above, plus a Client Component that fetches a namespace on
demand. It is part of the test suite, not a sample — it is where the real proxy,
the real Next.js runtime and the real WebAssembly binary are verified together.

## Where to go next

| | |
| --- | --- |
| [Folder structure](./folder-structure.md) | what is required, what is yours |
| [Translating](./translating.md) | `t`, `t.array`, `t.rich`, `t.has`, `t.raw` |
| [Routing](./routing.md) | strategies, prefixes, navigation, switching |
| [The proxy](./proxy.md) | setup, the matcher, composing, troubleshooting |
| [The CLI](./cli.md) | `check`, `build`, CI |
| [Errors](./errors.md) | codes, fallbacks, diagnostics |
| [API reference](./api.md) | every export |

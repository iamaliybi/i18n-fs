# i18n-fs

Folder-based internationalisation for Next.js, with a Rust core compiled to
WebAssembly.

```bash
npm install i18n-fs
```

Requires Next.js 14.2+ and Node 22.18+.

## What makes it different

**A missing translation never falls back to another language.** It falls back to
the string you supply, or to the key — and the console tells you exactly which
of "file missing", "invalid JSON", "scope absent", "key absent" or "wrong shape"
happened. `i18n-fs check` turns those into build failures, so a gap in one
locale is caught before a reader of that locale finds it.

**Routing is loop-safe by construction.** Path canonicalisation is idempotent
and redirects preserve the locale that was asked for. Both are asserted by
property tests over thousands of generated cases, and again end-to-end against a
real Next.js server.

**Your folders, your structure.** Messages are JSON files under `public/`. The
layout beneath the locale directory is entirely yours, and nothing here imposes
a shared-key convention — if you want shared keys, inject them.

## Getting started

### 1. Configure

```ts
// i18n-fs.config.ts
import { defineConfig } from 'i18n-fs/config';

export default defineConfig({
	locales: ['fa', 'en'],
	defaultLocale: 'fa',
	strategy: 'path', // 'path' | 'domain' | 'cookie'
	prefix: 'as-needed', // 'always' | 'as-needed' | 'never'
});
```

### 2. Add your messages

```
public/locales/fa/home/hero.json
public/locales/en/home/hero.json
```

```json
{
	"hero": {
		"title": "Welcome",
		"bullets": ["Fast", "Small"],
		"cta": { "label": "Get started" }
	},
	"terms": "Please read the <link>terms</link>"
}
```

### 3. Generate

```bash
npx i18n-fs build
```

This validates everything and writes `.i18n-fs/`: the resolved config each
runtime imports, a content hash per namespace so the browser can cache them
immutably, and a typed key registry.

### 4. Add the middleware

```ts
// middleware.ts
import { createI18nMiddleware } from 'i18n-fs/middleware';
import i18nConfig from './.i18n-fs/config.mjs';

export default createI18nMiddleware(i18nConfig);

export const config = {
	matcher: ['/((?!_next/|api/|.*\\.[^/]*$).*)'],
};
```

The matcher must be written out literally — Next.js reads it by static analysis
and will not accept an imported constant. **Note the double backslash:** `'\.'`
in a JavaScript string is just `.`, and a single one quietly stops the
middleware running on every path but `/`.

### 5. Render the provider

```tsx
// app/[locale]/layout.tsx
import { I18nProvider, setRequestLocale } from 'i18n-fs/server';

export default async function LocaleLayout({ children, params }) {
	const { locale } = await params;
	setRequestLocale(locale);

	return (
		<html lang={locale}>
			<body>
				<I18nProvider namespaces={['common']}>{children}</I18nProvider>
			</body>
		</html>
	);
}
```

`setRequestLocale` pins the `[locale]` segment for the request — a Server
Component cannot read the pathname, and the segment is authoritative under the
path strategy.

`namespaces` lists what to send to the browser. Server Components load what they
need themselves; anything a **Client** Component reads should be listed here, or
it will render its fallback during SSR and only fill in after hydration.

## Translating

The first argument is the file beneath the locale directory. The second is an
object inside it.

```ts
// Server Components
import { getTranslation } from 'i18n-fs/server';
const t = await getTranslation('home/hero', 'hero');
```

```ts
// Client Components
'use client';
import { useTranslation } from 'i18n-fs/client';
const t = useTranslation('home/hero', 'hero');
```

Both return the same thing:

```ts
t('title'); // "Welcome"
t('greeting', { name: 'Ali' }); // interpolation
t('missing', {}, { fallback: 'Get started' }); // your string, never another language
t.array('bullets'); // ["Fast", "Small"]
t.has('title'); // boolean, logs nothing
t.raw('greeting'); // the stored value, uninterpolated

t.rich('terms', { link: (chunk) => <a href="/terms">{chunk}</a> });
```

`t.rich` substitutes parameters *after* parsing, so a parameter can be a React
element rather than its stringification. Tags nest correctly, including inside a
tag of the same name.

## Navigation

```tsx
import { Link, useRouter, usePathname, useLocaleSwitcher } from 'i18n-fs/navigation';

<Link href="/about">About</Link>; // -> /about in fa, /en/about in en
<Link href="/about" locale="en">About</Link>; // always English
```

`href` is always locale-free, so switching routing strategy touches no link in
your application. `usePathname()` likewise gives you the path *without* its
locale prefix.

```tsx
const { locale, locales, switchTo, hrefFor } = useLocaleSwitcher();
```

`switchTo` reloads the page rather than doing a client transition: every layout
above the switcher was rendered in the old locale, and only a fresh request
re-runs them.

For redirects on the server:

```ts
import { redirect, permanentRedirect, getPathname } from 'i18n-fs/server';
```

## Checking your messages

```bash
npx i18n-fs check
```

Validates the config, reports invalid JSON with the line and column, and
compares every locale against the default one — by key **and by shape**, so a
key that is a string in one language and a list in another is caught before it
breaks `t.array` for the readers of exactly one language.

```bash
npx i18n-fs build
```

Runs the same checks, then writes `.i18n-fs/`. It refuses to write when `check`
finds an error. Add `--strict` to treat warnings as errors, or `--json` for
machine-readable output. Run `check` in CI.

## Routing strategies

| strategy | locale comes from | typical `prefix` |
| --- | --- | --- |
| `path` | the first URL segment | `as-needed` or `always` |
| `domain` | the hostname | `never` |
| `cookie` | the cookie only | `never` |

`prefix` controls whether the locale is visible in the URL:

- `always` — every locale prefixed, including the default
- `as-needed` — every locale except the unprefixed base one
- `never` — the URL never shows a locale

Under `domain`, the unprefixed locale is the one that host serves, not the
global default.

## Error codes

Behaviour is uniform; diagnosis is not.

| code | meaning |
| --- | --- |
| `NAMESPACE_NOT_FOUND` | the file could not be loaded |
| `INVALID_JSON` | it loaded but does not parse |
| `SCOPE_NOT_FOUND` | the file parsed; the scope object is absent |
| `KEY_NOT_FOUND` | the scope exists; the key does not |
| `TYPE_MISMATCH` | the key exists but holds the wrong shape |
| `PARAM_MISSING` | a `{placeholder}` had no matching parameter |
| `INVALID_CONFIG` | the configuration is inconsistent |

Diagnostics appear in development only, and each distinct problem is logged
once — not once per render.

## Development

Requires Rust (stable, with the `wasm32-unknown-unknown` target), `wasm-pack`
and Node 22.18+.

```bash
pnpm bootstrap
```

That installs, builds the three WebAssembly targets, syncs them into the
package, builds the package, and installs once more — the last step is what lets
pnpm link the CLI, which it cannot do before `dist/cli/main.js` exists.

Both Rust feature sets matter. The Edge middleware compiles the core with
`--no-default-features`, so a change that only builds with `full` breaks it:

```bash
cargo test --workspace --all-features
```

```bash
cargo test -p i18n-fs-core --no-default-features
```

```bash
pnpm typecheck && pnpm build && pnpm test
```

The example app is part of the test suite, not a sample — it is the only place
the real matcher, the real Edge runtime and the real WebAssembly binary meet:

```bash
pnpm example && pnpm example:test
```

## Contributing

Work happens on branches and lands through pull requests; `main` is never pushed
to directly. Every pull request that changes published behaviour needs a
changeset (`pnpm changeset`).

Architecture decisions are recorded in [`docs/adr/`](docs/adr/), and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) describes how the pieces fit. If
you are changing how something fundamental works, the ADR is part of the change.

## License

MIT

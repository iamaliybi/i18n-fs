# Routing

Two settings decide how the locale travels: **where it comes from** (`strategy`)
and **whether the URL shows it** (`prefix`).

```ts
export default defineConfig({
	locales: ['fa', 'en'],
	defaultLocale: 'fa',
	strategy: 'path',
	prefix: 'as-needed',
});
```

## `strategy` — where the locale comes from

### `path` (default)

The first URL segment. Best for SEO and for links people share: the URL names
the language, so a link opens in the language it was shared in.

```
/about        →  fa
/en/about     →  en
```

### `domain`

The hostname. For genuinely separate sites per language.

```ts
strategy: 'domain',
prefix: 'never',
domains: [
	{ domain: 'example.ir', locale: 'fa' },
	{ domain: 'example.com', locale: 'en' },
],
```

A domain may opt into serving extra locales by prefix:

```ts
{ domain: 'example.com', locale: 'en', locales: ['de-AT'] },
```

`example.com/de-AT/about` then works, and `example.ir/de-AT/about` does not —
that host never opted in, so the prefix is normalised away.

**Extra locales need a prefix to be reachable**, so pairing them with
`prefix: 'never'` asks for something impossible: the locale is declared and can
never be selected. `i18n-fs check` reports it rather than letting you find out
from a page in the wrong language. Either use `as-needed`, or give the locale a
domain of its own.

Under this strategy, the locale that goes **unprefixed** under `as-needed` is the
one the host serves, not the global default. On the English host `/about` is
English even if `defaultLocale` is Persian. Getting this wrong is what caused a
redirect loop during development; the fix is in
[ADR 0004](../adr/0004-loop-prevention.md).

Unlisted hosts — `localhost`, preview deployments — fall back to the cookie, so
local development still lets you switch language.

### `cookie`

Only the cookie. The URL never carries the locale, so pair it with
`prefix: 'never'`. Suitable for an authenticated app where a language preference
belongs to an account rather than a URL.

The trade-off is real: one URL renders different content per visitor. Search
engines index one version, and a shared link opens in the recipient's language,
not the sender's.

## `prefix` — whether the URL shows it

| value | `fa` (default) | `en` |
| --- | --- | --- |
| `always` | `/fa/about` | `/en/about` |
| `as-needed` | `/about` | `/en/about` |
| `never` | `/about` | `/about` |

`as-needed` keeps the default language's URLs clean. `always` is more uniform and
avoids any ambiguity about what `/about` means. `never` hides the locale
entirely and needs a cookie or a domain to carry it.

**`app/[locale]/` is required in every mode**, including `never`. The prefix is
removed from the URL the visitor sees, not from the route the router matches.
See [folder structure](./folder-structure.md).

Under `never`, a stray `/en/about` is **not** treated as a request for English —
the URL cannot express a locale in that mode, so honouring a prefix that the
next redirect strips would land the visitor somewhere else. It is normalised to
`/about` in whatever locale the cookie or host says.

## How the locale is chosen

Most authoritative first:

| # | source | applies to |
| --- | --- | --- |
| 1 | `setRequestLocale()` | wherever the app pins it |
| 2 | the `[locale]` path segment | `path`, and `domain` where the host opted in |
| 3 | the hostname | `domain` |
| 4 | the cookie | `path`, `cookie`, and unlisted hosts under `domain` |
| 5 | `Accept-Language` | all |
| 6 | `defaultLocale` | all |

**Anything that is not a configured locale is discarded, not trusted.** Every one
of these arrives from the client, and a locale becomes part of a filesystem path.

`Accept-Language` is matched by RFC 4647 Lookup: `fa-IR` matches a configured
`fa`. If you ship only `pt-BR` and the browser asks for `pt`, that matches too —
strict Lookup would not, but sending a Brazilian reader the default language
instead of Portuguese is not an improvement. Preference order always wins over
match precision: a `q=1.0` language you support loosely beats a `q=0.5` one you
support exactly.

## Redirects

| from | to | status | why |
| --- | --- | --- | --- |
| `/fa/about` (as-needed, fa default) | `/about` | **308** | true for every visitor |
| `/about` with `Accept-Language: en` | `/en/about` | **307** | depends on this visitor |

A negotiated redirect must never be cached as permanent, or the next visitor
inherits somebody else's language from a CDN.

Redirects are always same-origin. Moving a visitor between locale domains is a
deliberate action, which is what the switcher is for.

## Loop safety

Canonicalisation is idempotent, and a redirect is only ever emitted when the
path differs from its own canonical form — so a redirect target is a fixed point
and cannot redirect again. Redirects also preserve the locale that was asked
for; terminating on the *wrong* language would still be wrong.

Both properties are asserted over thousands of generated cases per run, and
again end-to-end against a real Next.js server. Three real bugs were found this
way, none of which the example-based tests caught. The reasoning is in
[ADR 0004](../adr/0004-loop-prevention.md).

## Navigation

```tsx
import { Link, useRouter, usePathname, useLocaleSwitcher } from 'i18n-fs/navigation';
```

`href` is always **locale-free**, so changing strategy or prefix touches no link
in your application:

```tsx
<Link href="/about">About</Link>              // /about in fa, /en/about in en
<Link href="/about" locale="en">English</Link> // always English
```

Anything that is not one of your paths — an absolute URL, `#section`,
`mailto:` — passes through untouched.

```tsx
const router = useRouter();
router.push('/about');
router.push('/about', { locale: 'en' });

const pathname = usePathname();   // "/about", never "/en/about"
```

`usePathname()` strips the prefix so a component can compare against `/about`
whatever the configuration is.

## Switching language

```tsx
const { locale, locales, switchTo, hrefFor } = useLocaleSwitcher();

<nav>
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
```

`hrefFor` gives a real URL, so the control is a real link — crawlable, and it
works with middle-click and "open in new tab".

`switchTo` writes the cookie and performs a **full page load**, not a client
transition. Every layout above the switcher was rendered in the old locale, and
only a fresh request re-runs them; a soft navigation would leave half the page in
the previous language.

Under `domain`, `hrefFor` returns an absolute URL when the target locale lives on
another host.

## Server-side redirects

```ts
import { redirect, permanentRedirect, getPathname } from 'i18n-fs/server';

await redirect('/login');
await redirect('/pricing', 'en');
const href = await getPathname('/about');
```

Locale-free paths, like the client wrappers.

<!-- nav:start -->

---

| | | |
| :-- | :--: | --: |
| ← [Plurals and formatting](./plurals-and-formatting.md) | [All guides](../README.md) | [The proxy](./proxy.md) → |

<!-- nav:end -->

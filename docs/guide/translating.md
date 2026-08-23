# Translating

`useTranslation` and `getTranslation` take the same two arguments, return the
same object, and behave identically. They differ only in that the server one is
async, because it reads from disk.

```ts
// Server Components, Route Handlers, Server Actions
import { getTranslation } from 'i18n-fs/server';
const t = await getTranslation('home/hero', 'hero');
```

```ts
// Client Components
'use client';
import { useTranslation } from 'i18n-fs/client';
const t = useTranslation('home/hero', 'hero');
```

## The two arguments

```
getTranslation(namespace, scope?)
                 │          │
                 │          └── an object inside that file
                 └───────────── the file, beneath the locale directory
```

Given `public/locales/fa/home/hero.json`:

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

The scope decides how deep you start:

```ts
const t = await getTranslation('home/hero');
t('hero.title');            // "Welcome"
t('terms');                 // "Please read the <link>terms</link>"

const hero = await getTranslation('home/hero', 'hero');
hero('title');              // "Welcome"
hero('cta.label');          // "Get started"

const cta = await getTranslation('home/hero', 'hero.cta');
cta('label');               // "Get started"
```

A scope is just a prefix. Use one when a component only ever touches one part of
a file, so its calls stay short and moving the component means changing one line.

---

## `t(key, params?, options?)`

A single message.

```ts
t('title');
// "Welcome"

t('greeting', { name: 'Ali', count: 3 });
// "Hello Ali, you have 3 messages"

t('missing', {}, { fallback: 'Get started' });
// "Get started"
```

### Parameters

`{name}` in a message is replaced by `params.name`. Numbers are converted with
`String()`.

```json
{ "greeting": "Hello {name}, you have {count} messages" }
```

`{{` and `}}` produce literal braces:

```json
{ "syntax": "Write {{name}} to interpolate" }
```
```ts
t('syntax'); // "Write {name} to interpolate"
```

A parameter you forget is **left visible**, not blanked:

```ts
t('greeting', { name: 'Ali' });
// "Hello Ali, you have {count} messages"   ← and PARAM_MISSING in the console
```

An empty gap hides the mistake; a visible marker does not.

### `options.fallback`

What to show when the lookup fails. This is the **only** fallback there is —
`i18n-fs` never substitutes another language's text ([why](./errors.md)).

```ts
t('cta.label', {}, { fallback: 'Get started' });
```

Without it you get the key back, which is a usable placeholder and an obvious
one in a screenshot.

---

## `t.array(key, params?, options?)`

A list of messages. Interpolation applies to every element.

```json
{ "bullets": ["Fast as {speed}", "Small"] }
```
```ts
t.array('bullets', { speed: 'lightning' });
// ["Fast as lightning", "Small"]
```

Rendering:

```tsx
<ul>
	{t.array('bullets').map((item) => (
		<li key={item}>{item}</li>
	))}
</ul>
```

On failure you get a single-element array — `[key]`, or `[fallback]` — so
`.map()` still works and the page still renders.

Asking `t()` for a list, or `t.array()` for a string, is a `TYPE_MISMATCH` and
the message says which one to use instead.

Individual elements are reachable by index (`t('bullets.0')`) but are
deliberately **not** in the generated types: a ten-item list would contribute ten
indexed keys and bury the real ones. Use `t.array(key)[0]`.

---

## `t.rich(key, tags?, params?, options?)`

A message with regions the caller renders.

```json
{ "terms": "Please read the <link>terms</link> before you <b>continue</b>" }
```
```tsx
t.rich('terms', {
	link: (chunk) => <a href="/terms">{chunk}</a>,
	b: (chunk) => <strong>{chunk}</strong>,
});
```

Translators see one sentence with its markup intact, instead of three fragments
they have to reassemble in an order their language may not use.

### Tags nest, including inside the same tag name

```json
{ "note": "<b>bold with <i>italic</i> inside</b>" }
```

`<b>a<b>c</b>d</b>` parses correctly too. A regex would close the outer tag at
the first `</b>` and lose the rest.

### A parameter can be a React element

```tsx
t.rich('greeting', { b: (c) => <strong>{c}</strong> }, { name: <Avatar user={me} /> });
```

Substitution happens **after** parsing, so an element stays an element. Anything
that interpolated first would have stringified it to `[object Object]`.

### Degrading

A tag you do not supply a renderer for is left as visible markup rather than
dropped, so the gap shows up in the page instead of hiding.

### Returns

`ReactNode` — a plain string when the message has no markup, otherwise an array
of elements. Render it directly; do not call `.trim()` or pass it where a string
is required.

---

## `t.has(key)`

Whether the key resolves to a message or a list. Returns a boolean, logs
nothing, never throws.

```tsx
{t.has('subtitle') && <p>{t('subtitle')}</p>}
```

Use it for genuinely optional content. Do not use it before every call — a
missing key already degrades safely, and `has` doubles the lookups.

Note that a key pointing at an *object* is `false`: an object is not a message.

---

## `t.raw(key)`

The stored value with no interpolation, or `undefined`.

```ts
t.raw('greeting');   // "Hello {name}, you have {count} messages"
t.raw('bullets');    // ["Fast", "Small"]
t.raw('nope');       // undefined
```

The escape hatch for doing your own formatting. Like `has`, it logs nothing —
it answers "is there a value" without reporting a problem.

---

## Types

After `i18n-fs build`, `.i18n-fs/messages.d.ts` describes every namespace, the
scopes inside it, and which keys are text and which are lists — generated from
your **default locale**, which is the source of truth for what exists.
`i18n-fs check` is what guarantees the other locales match it.

## Client Components and suspension

A Client Component reading a namespace the server did not send **fetches it and
suspends**. Two ways to deal with that:

```tsx
// Send it with the page — no fetch to wait for
<I18nProvider namespaces={['common', 'home/hero']}>
```

**`namespaces` puts the JSON in the HTML.** Not a hint, not a preload — the
server reads those files and serialises them into the document, so the browser
already has them before any JavaScript runs. That is why nothing waits, and it
is also the cost: every visitor carries those bytes whether or not the component
that reads them ever renders. `prefetch` is the opposite trade — a
`<link rel="preload">` and no bytes in the HTML. The four options are compared
[below](#prefetching-so-nothing-waits).

```tsx
// Or let it fetch, with a boundary to control what shows meanwhile
<Suspense fallback={<Skeleton />}>
	<Sidebar />
</Suspense>
```

Pre-loading is usually right for anything above the fold. Fetching is right for
a namespace only one rarely-opened panel needs.

### What actually disappears while it loads

Not just the component that called `useTranslation`. Suspending unwinds to the
**nearest `<Suspense>` boundary above it**, and that boundary's entire subtree is
replaced by its fallback:

```tsx
<Suspense fallback={<PageSkeleton />}>   {/* ← everything here is replaced */}
	<Header />
	<Article />
	<Sidebar />                            {/* ← only this one is waiting */}
</Suspense>
```

With no boundary anywhere above it, the suspension reaches the route and the
whole page waits. So put the boundary immediately around the part that fetches:

```tsx
<Header />
<Article />
<Suspense fallback={<SidebarSkeleton />}>
	<Sidebar />
</Suspense>
```

The reader never sees empty text that later fills in — they see the fallback,
then the finished component.

**Pre-loading removes the fetch, not the suspension.** The first Client
Component to translate anything also waits for the WebAssembly core to download
and instantiate, whether or not its namespace was sent — `useTranslation` reads
the core through `use()` before it looks at the namespace at all. That happens
once per page, so the first client translation on a page wants a boundary even
when every namespace is pre-loaded. Later ones do not: the core is already
there.

If no Client Component translates, the core is never fetched — see
[what it costs](../../README.md#what-it-costs-a-visitor).

**During server rendering a client fetch has no origin**, so a namespace that was
not sent renders its fallback in the HTML and only fills in after hydration. The
console says so, and names the fix. Anything a Client Component reads on first
paint belongs in `namespaces`.

### Prefetching, so nothing waits

Between "send it with the page" and "fetch it when it is needed" there is a
third option: start the request early and let it arrive before anything asks.

```tsx
// The request goes out with the HTML, in parallel with the JavaScript.
<I18nProvider namespaces={['common']} prefetch={['settings/panel']}>
```

That emits a `<link rel="preload">`. Unlike `namespaces` it does **not** put the
JSON in the payload, so the HTML does not grow — and unlike leaving it out
entirely, the browser is not still waiting when the component mounts.

```tsx
// Or start it on intent, and pay nothing for visitors who never ask.
import { usePrefetch } from 'i18n-fs/client';

const prefetch = usePrefetch();
const warm = () => prefetch('settings/panel');

<button onPointerEnter={warm} onFocus={warm} onClick={open}>Settings</button>
```

`onFocus` as well as `onPointerEnter`: a keyboard user never hovers and a touch
user has no hover at all, so prefetching only on hover gives the fastest
experience to the people who need it least.

| | payload | request starts | good for |
| --- | --- | --- | --- |
| `namespaces` | grows | never — it is already there | anything on first paint |
| `prefetch` | unchanged | with the HTML | a client-only subtree, a panel that opens shortly |
| `usePrefetch()` | unchanged | on hover, focus, or any intent | anything most visitors never open |
| neither | unchanged | when the component renders | rarely-used namespaces |

**Prefetching is a guess, and a guess that fails is forgotten.** A read that
fails is remembered, so one 404 does not become a request per render — but if a
prefetch cached its failure, a moment of bad network while guessing would decide
that the namespace is missing for the rest of the page's life, and the component
that actually needs it would render fallbacks having never tried. So a failed
prefetch leaves no trace and the real read starts clean.

Prefetching something read during **server** rendering does not help: the server
renders that component's fallback into the HTML while the client renders the
message, which React reports as a hydration mismatch. That case wants
`namespaces`.

### Choosing, in one question each

Work down the list and stop at the first yes.

1. **Is it read during server rendering, or visible on first paint?**
   `namespaces`. Anything else renders a fallback into the HTML and swaps it
   after hydration, which the reader sees and React may report as a mismatch.
2. **Will most visitors see it, a moment after the page settles?**
   `prefetch`. The request leaves with the HTML and the payload does not grow,
   so it costs bytes only for people who were going to need them anyway.
3. **Do only some visitors open it, and is there an event that says so?**
   `usePrefetch()` on `onPointerEnter` and `onFocus`. Visitors who never open
   it never pay.
4. **Otherwise** — leave it out. The component fetches on mount and suspends;
   give it a `<Suspense>` boundary and be done.

A worked example, all four in one layout:

```tsx
// app/[locale]/layout.tsx
<I18nProvider
	namespaces={['common', 'home/hero']}   // the header and the page itself
	prefetch={['home/aside']}              // below the fold, arrives before it is scrolled to
>
	{children}
</I18nProvider>
```

```tsx
// A dialog most visitors never open.
'use client';
import { usePrefetch } from 'i18n-fs/client';

export function SettingsButton({ onOpen }: { onOpen: () => void }) {
	const prefetch = usePrefetch();
	const warm = () => prefetch('settings/panel');

	return (
		<button onPointerEnter={warm} onFocus={warm} onClick={onOpen}>
			Settings
		</button>
	);
}
```

### Checking that it worked

In the browser's network panel, filter for `.json`:

- `namespaces` — **no request at all.** The messages are in the HTML.
- `prefetch` — one request, started at the same time as the JavaScript rather
  than after it, and marked as `preload`. When the component mounts it reads
  from the cache and makes no second request.
- `usePrefetch()` — one request the moment you hover the control, and none if
  you do not.

Two requests for the same namespace means the prefetch did not match the read:
the usual cause is a different namespace string, since `home/aside` and
`home/aside.json` are not the same key.

The WebAssembly core is a separate matter: it is fetched once per page, by
whichever Client Component translates first, and prefetching a namespace does
not start it early.

## Where to put the provider

`<I18nProvider>` usually goes in `app/[locale]/layout.tsx`, above everything.
That is the simple case: one list of namespaces for the whole app.

It can also go lower — in a route group's layout, or in a single page — when one
section needs messages the rest of the app does not. A dashboard that ships six
namespaces to nobody but the dashboard is a real saving.

**A nested provider extends the outer one.** List only what the section adds:

```tsx
// app/[locale]/layout.tsx
<I18nProvider namespaces={['common']}>{children}</I18nProvider>

// app/[locale]/dashboard/layout.tsx — 'common' is already there
<I18nProvider namespaces={['dashboard/nav', 'dashboard/charts']}>
	{children}
</I18nProvider>
```

Naming the same namespace in both is allowed and the inner one wins, which is
how a section ships its own copy of a shared namespace.

Inheritance stops at a change of locale. Two locales in one tree is unusual, but
handing one locale's messages to the other's subtree would be worse than making
it list them again — so a provider whose locale differs from the one above it
starts from nothing.

So: one provider at the root is the default, and more than one is a size
optimisation — a dashboard that ships six namespaces to nobody but the
dashboard.

## Caching, and editing messages while the server runs

| | server | client |
| --- | --- | --- |
| read by | `fs`, no HTTP | `fetch` from `public/`, with `?v=<hash>` |
| cached | per process, per locale | per page load, in module scope |
| after you edit a file | re-read on the next render | reload the page |

In development the server compares the file's timestamp before trusting its
cache, so editing a message file shows up on the next render. That check exists
because message files live under `public/`: editing one changes no module, so
Next.js has nothing to reload and would otherwise keep serving the old text until
you restarted. In production nothing is stat-ed — the files cannot change under a
running build.

The client fetches with `cache: 'no-store'` in development for the same reason:
the content hash in the URL comes from the build manifest, which does not move
while you are editing, so the browser would otherwise serve its cached copy.

If a change still does not appear after a reload, restart the dev server — the
console diagnostics say so too.

<!-- nav:start -->

---

| | | |
| :-- | :--: | --: |
| ← [Folder structure](./folder-structure.md) | [All guides](../README.md) | [Routing](./routing.md) → |

<!-- nav:end -->

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
// Pre-load it — no waiting, no boundary
<I18nProvider namespaces={['common', 'home/hero']}>
```

```tsx
// Or let it fetch, with a boundary to control what shows meanwhile
<Suspense fallback={<Skeleton />}>
	<Sidebar />
</Suspense>
```

Pre-loading is usually right for anything above the fold. Fetching is right for
a namespace only one rarely-opened panel needs.

**During server rendering a client fetch has no origin**, so a namespace that was
not sent renders its fallback in the HTML and only fills in after hydration. The
console says so, and names the fix. Anything a Client Component reads on first
paint belongs in `namespaces`.

# Plurals and formatting

Two things that are not translation but that every translated page needs:
choosing between `1 file` and `2 files`, and writing a date the way the reader
writes dates.

Both are the runtime's `Intl`, not this package's. That matters for what they
cost, and it is worth saying up front: **the formatters download nothing**, and
plural support added about 7 KB gzip to the binary a Client Component fetches —
55.7 to 62.8. The [current figures](../../README.md#what-it-costs-a-visitor) are
measured on every release rather than written down once.

---

## Why `count === 1 ? … : …` is not enough

In English there are two forms and the check works. In Russian there are three,
and 21 goes back to the singular:

| count | Russian | what `count === 1` gives |
| ---: | --- | --- |
| 1 | 1 файл | ✔ файл |
| 2 | 2 файла | ✘ файлов |
| 21 | 21 файл | ✘ файлов |

Arabic has six forms, including one for exactly two. Persian counts zero as
singular. These are grammatical facts about each language, and there is a
second problem beyond getting them right: **a translator cannot fix a rule that
lives in your TSX**. They have a JSON file, and the bug is in a file they do not
read, in a language they may not know.

So the choice moves into the message, where the person who speaks the language
can edit it.

---

## `plural`

```jsonc
// messages/en/inbox.json
{ "files": "{count, plural, one {# file} other {# files}}" }

// messages/ru/inbox.json  ← three arms, written by whoever speaks Russian
{ "files": "{count, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}" }

// messages/fa/inbox.json  ← Persian needs no arms at all
{ "files": "{count} فایل" }
```

One call, in every language:

```tsx
const t = await getTranslation('inbox');

t('files', { count: 21 });   // en: "21 files"   ru: "21 файл"   fa: "۲۱ فایل"
```

Inside an arm, `#` is the number **formatted for the locale** — `۱٬۲۳۴` in
Persian, `1,234` in English. Write `##` for a literal `#`.

### The arm names

`zero`, `one`, `two`, `few`, `many`, `other` — CLDR's categories. Which ones a
language uses is the language's business; you only write the ones yours needs,
and `other` is the one every message should have.

### `=n` for an exact count

```json
{ "files": "{count, plural, =0 {No files yet} one {# file} other {# files}}" }
```

`=0` is checked before the categories and wins, which is what you want: whether
zero is grammatically singular differs between languages, and "no files yet" is
not a grammatical question at all.

---

## `selectordinal`

Ranks, not counts. The categories differ from the cardinal ones for the same
number — 2 is `other` when counting and `two` when ranking:

```json
{ "place": "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}" }
```

```ts
t('place', { n: 1 });    // "1st"
t('place', { n: 22 });   // "22nd"     — not "22th"
```

---

## `select`

Matched on the value itself rather than on a number. For anything with a fixed
set of cases:

```json
{ "invited": "{gender, select, female {She was invited} male {He was invited} other {They were invited}}" }
```

```ts
t('invited', { gender: user.gender });
```

---

## Nesting, and the one rule that differs from ICU

Arms can contain placeholders, tags and other arguments:

```json
{ "summary": "{count, plural, other {<b>{name}</b> uploaded # files}}" }
```

Inside an arm, braces are **structural**, and `{{` / `}}` are not escapes there.
They cannot be: an arm that opens with a placeholder — `other {{name} won}` —
begins with two braces that are both real. At the top level `{{` still produces
a literal brace, exactly as before.

> ICU resolves the same ambiguity by quoting with apostrophes, which makes every
> `don't` in a message a trap. This package keeps the escape where it always
> was and drops it inside arms, which costs a literal brace in a position nobody
> writes one.

---

## When something is wrong

Three separate codes, because they are three separate mistakes
([all codes](./errors.md)):

| code | what happened | what renders |
| --- | --- | --- |
| `PARAM_MISSING` (300) | you did not pass the argument | `{count}` |
| `PLURAL_NOT_NUMERIC` (301) | you passed it, but it was not a number | the `other` arm |
| `NO_MATCHING_ARM` (302) | nothing matched and there is no `other` | `{count}` |

The page always renders. A sentence with one odd plural beats a hole where a
sentence should be.

---

## Formatting

`getFormatter()` on the server, `useFormatter()` in a Client Component. Same
object either way.

```tsx
import { getFormatter } from 'i18n-fs/server';

const format = await getFormatter();

format.number(1234567.89);                                    // ۱٬۲۳۴٬۵۶۷٫۸۹
format.number(250000, { style: 'currency', currency: 'IRR' });
format.number(1200000, { notation: 'compact' });              // ۱٫۲ میلیون
format.dateTime(order.placedAt, { dateStyle: 'full' });       // ۱۴۰۵ شهریور ۹
format.dateTimeRange(start, end, { month: 'long', day: 'numeric' });
format.relativeTime(comment.createdAt);                       // ۳ روز پیش
format.list(tags);                                            // سیب، پرتقال، و موز
names.sort(format.compare);                                   // آ before ا
```

Every option is `Intl`'s own, passed straight through.

### The Persian calendar is free

`Intl.DateTimeFormat('fa-IR')` resolves to the Persian calendar by itself. A
Jalali date needs no date library and adds no bytes — the same is true of the
Arabic, Hebrew, Thai and Japanese calendars.

### `relativeTime` and hydration

The unit is chosen by size unless you name one. Left alone it measures against
"now", and "now" on the server is not "now" in the browser — a timestamp that
renders `2 minutes ago` and hydrates as `3 minutes ago` is a React hydration
error. Pass a fixed `now` when the same value is rendered on both sides:

```tsx
format.relativeTime(postedAt, { now: renderedAt });
```

It says `yesterday` rather than `1 day ago`; pass `numeric: 'always'` for the
other wording.

### What it costs

Nothing. `Intl` is part of the runtime, so a page that formats dates and prices
but translates nothing on the client downloads **no WebAssembly at all** — which
is asserted, not assumed, in `test/tree-shaking.test.ts`.

<!-- nav:start -->

---

| | | |
| :-- | :--: | --: |
| ← [Translating](./translating.md) | [All guides](../README.md) | [Routing](./routing.md) → |

<!-- nav:end -->

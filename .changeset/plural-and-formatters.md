---
'i18n-fs': minor
---

Plural, ordinal and select arguments in messages, and locale-aware formatters.

`t()` now understands ICU's `plural`, `selectordinal` and `select`, so the
grammar of counting lives in the message rather than in your component:

```json
{ "files": "{count, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}" }
```

```ts
t('files', { count: 21 });   // "21 файл" — not the plural form
```

That matters beyond correctness: `count === 1 ? … : …` in a component is a rule
a translator cannot reach, in a file they do not read. Inside an arm, `#` is the
number formatted for the locale, `##` is a literal `#`, and `=0` selects an
exact count ahead of the grammatical arms.

The categories come from the runtime's own `Intl.PluralRules` rather than from
CLDR tables compiled into the binary — every runtime this package targets
already ships them. This cost the browser binary 7.4 KB gzip, 55.7 → 63.1.

New alongside it, and free: `getFormatter()` and `useFormatter()` for numbers,
currency, dates, ranges, relative time, lists and locale-aware sorting. It is
`Intl`, so a page that formats but does not translate on the client downloads no
WebAssembly at all — and the Persian, Arabic, Hebrew and Japanese calendars come
with it, so a Jalali date needs no date library.

Two new error codes, because they are two distinct mistakes:
`PLURAL_NOT_NUMERIC` (301) when a plural argument is not a number, and
`NO_MATCHING_ARM` (302) when nothing matched and the message has no `other`.

One deliberate deviation from ICU: inside an arm, braces are structural and
`{{`/`}}` are not escapes. They cannot be — `other {{name} won}` opens with two
braces that are both real. ICU resolves this by quoting with apostrophes, which
makes every `don't` a trap; the escape stays where it was at the top level, so
existing messages are unaffected.

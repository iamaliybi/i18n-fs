---
'i18n-fs': patch
---

The floor of `peerDependencies` is now tested, not assumed.

`peerDependencies` allows `next@^14.2` and `react@^18.3`, and nothing tested either — both example apps were on Next 15/16 with React 19. `examples/next-14-react-18` closes that, running the same 25 assertions as the others.

It exists for one claim in particular. `useTranslation` calls React's `use()`, which is not in the React 18 release, so the declared range looked wrong. It is not: the App Router does not run the React in your `package.json` — Next vendors its own, and 14.2.33 vendors `18.3.0-canary-178c267a4e` with `use()` in it. Verified from the vendored build rather than inferred.

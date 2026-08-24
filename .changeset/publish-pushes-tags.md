---
'i18n-fs': patch
---

Publishing now pushes its tag, and the missing tags and GitHub releases have been filled in.

`changeset publish` writes a git tag locally and nothing pushes it. While publishing ran in CI that did not matter — `changesets/action` pushed the tag and opened a GitHub release in the same step — but that step only runs when an npm credential is present, and publishing here is manual. So 0.3.0 through 0.7.0 reached npm with no tag on the remote and no release: five versions where nothing connected the published package to the commit it was built from.

`npm run release` ends with `git push --follow-tags` now, and a test fails when the newest changelog entry has no tag behind it — the symptom otherwise is silence, which is how this lasted five versions.

All eight tags are on the remote, and every published version has a GitHub release whose notes are its own changelog section rather than a second description written by hand. `npm run releases:check` reports gaps; `npm run releases:create` fills them.

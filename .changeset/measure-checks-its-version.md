---
'i18n-fs': patch
---

The size table now says which version it was measured from, and that claim is checked.

It read "from i18n-fs 0.6.0" while the package was 0.7.2. The numbers were right — CI compares them against the binaries on every pull request — but the check deliberately skipped the line above the table, so the provenance went stale through three releases while the guard reported everything in order. A figure that is correct and says it came from somewhere it did not is a quieter kind of wrong than a figure that is simply out of date.

`measure --check` now compares the version in that line against `package.json` and fails with both numbers when they differ. The date is still informational: it records when the block was regenerated, which is a different question from which build it describes.

To keep that from turning the release pull request red the moment it bumps the version, `changeset:version` regenerates the table as part of versioning — so a release carries figures taken from the build it describes, without anyone remembering to re-run anything.

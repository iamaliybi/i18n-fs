---
'i18n-fs': patch
---

The lockfile now follows a release instead of lagging one version behind.

`changeset version` bumps `package.json` and leaves `package-lock.json` alone, so every published version left the committed lockfile naming the previous one. `npm ci` tolerates the mismatch, which is exactly why nobody noticed — the only symptom is that the first `npm install` after a release leaves a modified file nobody asked for, on someone else's branch.

The release script refreshes the lockfile as part of versioning, and a test asserts the two agree.

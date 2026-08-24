---
'i18n-fs': patch
---

The release check now asks the remote, because the check added yesterday was looking at the wrong thing.

It compared the changelog against local git tags. Every one of the five missing tags was present locally the whole time — unpushed — so that check would have passed throughout the problem it was written for. It also failed in a state that is entirely correct: between merging a version pull request and publishing, the changelog names a version that has no tag yet, which turned the suite red for a legitimate window.

`npm run releases:check` compares the npm registry against `git ls-remote` and against the GitHub releases, reports each gap separately because they fail separately, and exits non-zero. Tags are reported, never created: a tag names a commit, and guessing which one is not a script's job — it prints the `git push` to run instead.

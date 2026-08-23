# ADR 0010 — npm workspaces, not pnpm

Status: accepted
Date: 2026-08-23

## Context

The repository used pnpm from the first commit. That was not a considered
decision: pnpm was installed on the machine the project started on, and it is
the conventional choice for a monorepo. No requirement was ever traced to it.

The cost is paid by everyone else. A contributor who has Node has npm; to work
here they had to install a second package manager and learn a second set of
flags first. For a package whose own audience is "install it and it works", that
is a poor first impression of the repository.

So the question was asked directly: what actually depends on pnpm?

## What was measured

The pnpm surface turned out to be small — `workspace:*` in the two example
manifests, `--filter` in five root scripts, `allowBuilds` in
`pnpm-workspace.yaml`, and the CI setup action. Rather than reason about whether
npm could cover it, the migration was performed on a spike branch and the entire
suite run against it.

Everything passes on npm: 120 Rust tests, 164 package tests, both example apps
built, 44 end-to-end assertions across two Next.js majors, and the documentation
check.

Not on the first attempt, though. The migration surfaced two defects that had
been in the repository all along, each hidden by something about the old setup —
which is most of what the exercise was worth.

### The two-install bootstrap was a workaround for the wrong problem

`bin` pointed at `dist/cli/main.js`, which is generated. During a first install
that file does not exist, so pnpm wrote no shim — and a second install alone did
not fix it, because pnpm saw an up-to-date tree and did nothing.
`scripts/relink.mjs` existed to clear the tree so a second install would take
effect, and `bootstrap` ran `install` twice around the build.

The first version of this migration claimed npm links the bin regardless of
whether the target exists. That is true **only on Windows**, which is where it
was tested. npm links a bin by creating the link and then marking the target
executable; on Linux and macOS that chmod fails with ENOENT when the target is
missing, and npm skips the link without reporting it. Windows has no chmod step.
So the local run looked clean and CI failed with `i18n-fs: not found` on both
examples.

Neither package manager was really at fault. Pointing `bin` at a generated file
is the defect. `packages/i18n-fs/bin/i18n-fs.mjs` is now a committed launcher
that hands over to `dist/cli/main.js`, so the `bin` target exists at every
install, on every platform, under every package manager. One install is enough —
and it would have been enough under pnpm too.

`relink.mjs`, the second install and the CI step that ran them are deleted.
`verify-package.mjs` now fails if `bin` ever points back into `dist/`, because
this is a defect a Windows machine cannot see.

### Hoisting exposed a latent bug in the end-to-end runner

The two examples are on different Next.js majors, so a hoisting package manager
must put one at the workspace root and nest the other. npm hoists Next 15 to the
root and nests 16 under `examples/next-16-proxy`; each example still resolves
its own major correctly.

But the runner spawned `<example>/node_modules/next/dist/bin/next` as a literal
path, which only holds when nothing is hoisted. It now resolves Next from the
example's own manifest, which is correct under any package manager — including
pnpm. This was a real fragility that the pnpm layout happened to hide.

### Speed and disk

On this machine a clean install takes **16s with npm** and **40s with pnpm**.
pnpm's content-addressed store saves disk across many projects, which is a real
benefit and not one measured here — but it buys nothing on the axis that
prompted the question, and it is not worth a mandatory extra tool for a
repository with one package and two examples.

## Decision

Use npm workspaces. `npm install` at the root is the whole setup, beyond the
Node version in `.nvmrc`.

## Consequences

Contributors need Node and nothing else. `package-lock.json` replaces
`pnpm-lock.yaml`; CI uses `npm ci` and drops `pnpm/action-setup`.

Nothing about the published package changes — same files, same entry points,
same behaviour. This is a repository decision, not a product one, which is why
it carries no changeset.

The disk-sharing argument would come back if this repository grew to many
packages with heavy shared dependencies. It has one package and two examples;
if that changes materially, this is worth revisiting.

# i18n-fs

Folder-based internationalisation for Next.js, with a Rust core compiled to
WebAssembly.

> **Status: pre-release.** The foundation and the Rust core are in place. The
> React and Next.js layers are not published yet — see
> [Roadmap](#roadmap).

## What it is

- **Folder-based.** Your messages are JSON files under `public/`. The folder
  layout is entirely yours; `i18n-fs` imposes no structure and no shared-key
  convention.
- **Rust core.** Locale negotiation, route canonicalisation, message resolution
  and rich-text parsing are Rust, compiled to three WebAssembly binaries — one
  per runtime, so the Edge middleware carries only what middleware needs.
- **No cross-language fallback.** A missing Persian string never silently
  renders the English one. It falls back to your string, or to the key, and
  tells you exactly what went wrong.
- **Loop-safe routing.** The redirect logic is idempotent by construction and
  proven so by property tests, not by care.

## Configuration

```ts
// i18n-fs.config.ts
import { defineConfig } from 'i18n-fs/config';

export default defineConfig({
  locales: ['fa', 'en'],
  defaultLocale: 'fa',
  strategy: 'path', // 'path' | 'domain' | 'cookie'
  prefix: 'as-needed', // 'always' | 'as-needed' | 'never'
});
```

## Messages

```
public/locales/fa/home/hero.json
public/locales/en/home/hero.json
```

```ts
const t = useTranslation('home/hero', 'cta');

t('label');
t('label', { name: 'Ali' });
t('label', {}, { fallback: 'Get started' });
t.rich('terms', { link: (chunk) => <a href="/terms">{chunk}</a> });
t.array('bullets');
```

The first argument is the file, the second is an object inside it.

## Checking your messages

Because a missing translation never falls back to another language, it has to be
caught at build time:

```bash
npx i18n-fs check
```

It validates the config, reports invalid JSON with the line and column, and
compares every locale against the default one — by key *and* by shape, so a key
that is a string in one language and a list in another is caught before it
reaches a reader.

```bash
npx i18n-fs build
```

Runs the same checks, then writes `.i18n-fs/`: the resolved config every runtime
imports, a content hash per namespace so the browser can cache immutably, and a
typed key registry. It refuses to write if `check` finds an error.

Add `--strict` to treat warnings as errors, or `--json` for machine-readable
output.

## Development

Requires Rust (stable, with the `wasm32-unknown-unknown` target), `wasm-pack`
and Node 22.18+ — that is the version that reads a TypeScript config file
without a bundler.

```bash
pnpm install
```

Build the three WebAssembly targets and check their size budgets:

```bash
pnpm wasm:build
```

Copy the built artefacts into the package:

```bash
node scripts/sync-wasm.mjs
```

Run the Rust suites. Both feature sets matter — the Edge middleware compiles the
core with `--no-default-features`, so a change that only builds with `full`
breaks it:

```bash
cargo test --workspace --all-features
```

```bash
cargo test -p i18n-fs-core --no-default-features
```

Run the JavaScript side:

```bash
pnpm typecheck && pnpm build && pnpm -r test
```

## Contributing

Work happens on branches and lands through pull requests; `main` is never pushed
to directly. Every pull request that changes published behaviour needs a
changeset (`pnpm changeset`).

Architecture decisions are recorded in [`docs/adr/`](docs/adr/). If you are
changing how something fundamental works, the ADR is part of the change.

## Roadmap

| PR  | scope                                                        |
| --- | ------------------------------------------------------------ |
| #1  | foundation, Rust core, three WASM targets                     |
| #2  | CLI: check, build, manifest, typegen — **this one**           |
| #3  | server layer: `getLocale`, `getTranslation`, `I18nProvider`   |
| #4  | client layer: `useTranslation`                                |
| #5  | middleware and Next.js wrappers; Playwright loop tests        |
| #6  | example app, documentation, first publish                     |

## License

MIT

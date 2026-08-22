## What this changes

<!-- One paragraph. What behaviour is different after this lands? -->

## Why

<!-- The problem being solved, not a restatement of the diff. -->

## Checklist

- [ ] `cargo fmt --all -- --check` passes
- [ ] `cargo clippy` passes with no warnings, in **both** the full and minimal feature sets
- [ ] `cargo test` passes in both feature sets
- [ ] `pnpm typecheck && pnpm build && pnpm -r test` pass
- [ ] The Edge WASM build is still within its gzip budget (`pnpm wasm:build`)
- [ ] A changeset is included, or this PR changes no published behaviour
- [ ] Any architectural decision is recorded in `docs/adr/`

## Notes for the reviewer

<!-- Trade-offs taken, things deliberately left out, anything worth a second opinion. -->

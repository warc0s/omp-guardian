# Contributing

Changes to this extension can affect whether agent actions execute. Keep patches
narrow, explain the safety impact, and add regression tests for behavior changes.

## Setup

```bash
git clone https://github.com/Warc0s/omp-guardian.git
cd omp-guardian
bun install --frozen-lockfile
bun run check
```

## Pull request requirements

1. `bun run check`, `bun run test:coverage`, and `bun run test:stress` pass.
2. Safety changes include tests demonstrating the preserved invariant.
3. Runtime, routing, subprocess, audit, or build changes include a fresh OMP
   live-smoke result.
4. Fixtures are synthetic and contain no secrets or personal paths.
5. Public code, documentation, logs, errors, and test text are in English.
6. User-visible changes are recorded under `[Unreleased]` in `CHANGELOG.md`.

The most sensitive paths are `src/omp/runtime.ts`, `src/omp/routing.ts`,
`src/omp/invoker.ts`, `src/decision.ts`, `src/emergency-brake.ts`, and
`src/redact.ts`.

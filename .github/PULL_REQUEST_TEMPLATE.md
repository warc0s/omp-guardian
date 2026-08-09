<!-- Thanks for the PR. Keep the description focused on the technical change. -->

## Summary

<!-- What does this PR change and why? One or two paragraphs. -->

## Safety impact

<!-- If this touches decision.ts, policy.ts, emergency-brake.ts, the reply
     transport, or the config trust boundary, explain why the safety invariants
     are preserved (critical risk never approved, project config cannot weaken
     global, reviewer failure → manual, etc.). If it does not touch safety
     paths, say "None". -->

## Checklist

- [ ] `bun run check` is green (format + lint + typecheck + tests + build)
- [ ] No personal data, secrets, or absolute personal paths in the diff
- [ ] Safety changes include regression tests that demonstrate the invariant
- [ ] User-facing strings are in English
- [ ] CHANGELOG entry added (under `[Unreleased]`) if user-visible
- [ ] No version numbers or roadmap references added to code comments

## Test evidence

<!-- For runtime/routing/subprocess/audit/build changes: attach the live smoke
     result from a freshly built extension and new OMP process. -->

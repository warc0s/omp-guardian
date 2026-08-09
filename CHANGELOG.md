# Changelog

All notable changes are documented here. The format follows Keep a Changelog
and this project uses Semantic Versioning.

## [Unreleased]

**Breaking:** this release renames the project brand and identifiers from
OMP Approval Reviewer to OMP Guardian. The display name, repository, package
name, public API symbols, subprocess environment variables, and OMP
configuration and audit paths all change. See the migration notes below.

### Changed

- Renamed the project brand and identifiers to OMP Guardian. The display name,
  repository, package name, public API symbols (`OmpGuardian`,
  `installOmpGuardian`), and subprocess environment variables
  (`OMP_GUARDIAN_HOST`, `OMP_GUARDIAN_CHILD`) now use the OMP Guardian identity.

### Removed

- Dropped the legacy `omp-approval-reviewer` identifiers and the previous
  `OmpApprovalReviewer` / `installOmpApprovalReviewer` / `OMP_APPROVAL_REVIEWER_*`
  names.

### Migration

- Global configuration moved from `~/.omp/agent/omp-approval-reviewer.jsonc` to
  `~/.omp/agent/omp-guardian.jsonc`.
- Project hardening moved from `<repository>/.omp/approval-reviewer.jsonc` to
  `<repository>/.omp/guardian.jsonc`.
- The audit trail moved from
  `~/.omp/agent/omp-approval-reviewer-audit.jsonl` to
  `~/.omp/agent/omp-guardian-audit.jsonl`. Rename the existing file to preserve
  prior records.

## [0.1.0-beta.1] - 2026-08-09

### Added

- Initial public beta for Oh My Pi.
- Deterministic routing for routine Bash, workspace edits, local tests, and
  read-only tool actions.
- Tool-free model review for risky or ambiguous actions with a versioned
  structured decision.
- Emergency brake for unmistakable destruction and credential exfiltration.
- Trusted-global and project-hardening configuration layers.
- Redacted mode-`0600` JSONL audit records and a per-session denial circuit
  breaker.
- Git, SSH, local-script, path, and shell-capability evidence enrichment.

### Security

- Reviewer subprocesses disable tools, sessions, skills, rules, LSP, PTY,
  title generation, and prewalk.
- Invalid decisions, unavailable reviewers, timeouts, and headless escalation
  fail closed.
- Project configuration cannot weaken trusted global policy.

# OMP Approval Reviewer

> [!IMPORTANT]
> This project is an early **beta**. It makes security-sensitive decisions and
> should be treated as defense in depth, not as a sandbox or a replacement for
> operating-system isolation.

> [!NOTE]
> This is an unofficial community extension for Oh My Pi (OMP). It is not
> affiliated with or endorsed by the OMP maintainers.

A policy-aware approval reviewer for OMP. It shadows Bash, inspects sensitive
tool calls, and asks a separate tool-free model process to return one structured
decision: `allow`, `deny`, or `escalate`.

[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.3.0-000000)](https://bun.sh)
[![License](https://img.shields.io/github/license/Warc0s/omp-approval-reviewer?color=blue)](./LICENSE)
[![Checks](https://img.shields.io/github/actions/workflow/status/Warc0s/omp-approval-reviewer/ci.yml?branch=main&label=checks)](https://github.com/Warc0s/omp-approval-reviewer/actions/workflows/ci.yml)

## What it does

- Shadows OMP's Bash tool and delegates to native Bash exactly once after an
  allow decision.
- Lets routine reads, bounded workspace writes, and recognized local tests use
  a cheap deterministic route.
- Reviews network access, deletion, Git mutation, package lifecycle execution,
  privilege changes, remote operations, protected-path access, browser input,
  Python/notebook execution, MCP tools, and unknown tools.
- Rejects unmistakable root destruction, destructive block-device operations,
  fork bombs, configured executables, and obvious credential exfiltration
  before any model call.
- Runs model reviews in a separate OMP process with tools, sessions, skills,
  rules, LSP, PTY, title generation, and prewalk disabled.
- Fails closed on invalid output, timeout, provider failure, missing model, or
  unavailable manual review.
- Writes an append-only JSONL audit trail containing an action hash rather than
  the raw command. Secrets are redacted and the file is mode `0600`.

## Requirements

- OMP `>=17.2.12 <18`
- Bun `>=1.3.0`
- An OMP model provider that is already authenticated

OMP extension APIs are not stable across major versions. The extension refuses
to claim compatibility with an unverified OMP major release.

## Install from GitHub

This beta is intentionally not published to npm.

```bash
git clone https://github.com/Warc0s/omp-approval-reviewer.git
cd omp-approval-reviewer
bun install --frozen-lockfile
bun run check
bun run build
omp plugin link "$PWD" --scope user
omp plugin list
```

Rebuild after pulling source changes. To unlink it:

```bash
omp plugin uninstall omp-approval-reviewer
```

You can also load a checkout for one invocation without linking it:

```bash
omp --no-extensions \
  -e /absolute/path/to/omp-approval-reviewer/dist/index.js \
  "Your request"
```

Do not use `--yolo`. `--auto-approve` can be used in a trusted repository: the
extension's own gate still wraps Bash and selected sensitive tools.

## Configuration

Trusted global configuration:

```text
~/.omp/agent/omp-approval-reviewer.jsonc
```

Optional project hardening:

```text
<repository>/.omp/approval-reviewer.jsonc
```

Start from [config/omp-approval-reviewer.example.jsonc](./config/omp-approval-reviewer.example.jsonc).
The defaults inherit the active OMP model and thinking level:

```jsonc
{
  "reviewerModel": "current",
  "reviewerThinking": "current",
  "timeoutMs": 24000,
  "confidenceThreshold": 0.7,
  "escalationMode": "manual",
  "audit": true,
  "reviewMcp": true,
  "reviewUnknownTools": true,
  "reviewTools": ["python", "notebook", "browser", "computer", "delete", "move"],
  "autoAllowWorkspaceEdits": true,
  "autoAllowReadOnlyBash": true,
  "autoAllowLocalTests": true,
  "reviewSubagentSpawns": false,
  "trustedWriteRoots": [],
  "deniedBashExecutables": ["sudo"],
}
```

A trusted global config may select a dedicated reviewer:

```jsonc
{
  "reviewerModel": "openai-codex/gpt-5.6-luna",
  "reviewerThinking": "max",
}
```

Project configuration can only tighten the trusted baseline. It cannot change
the reviewer provider, disable auditing, remove protected paths or reviewed
tools, add trusted write roots, or lower the confidence threshold. See
[Configuration](./docs/configuration.md) for the complete trust boundary.

## Decision flow

1. Trusted hard policy and the emergency brake run first.
2. Static command and path analysis determines whether an action is routine,
   denied, or needs review.
3. Ambiguous or risky actions receive bounded, redacted session and action
   evidence.
4. A tool-free reviewer emits the versioned structured decision.
5. Deterministic confidence, risk, authorization, scope, and evidence gates can
   only make an allow more restrictive.
6. OMP executes once, blocks, or asks the user for an explicit allow-once.

The per-session circuit breaker stops the active turn after three consecutive
or twenty cumulative denials.

## Audit trail

The default path is:

```text
~/.omp/agent/omp-approval-reviewer-audit.jsonl
```

Records include the decision source, schema versions, action hash, outcome,
rationale, model identity, timing, and available decision fields. Raw commands
are not stored. Treat the file as private despite redaction.

## Development and verification

```bash
bun install --frozen-lockfile
bun run check
bun run test:coverage
bun run test:stress
```

`bun run check` performs formatting, lint, strict TypeScript checking, the full
test suite, and the production build. Runtime, routing, subprocess isolation,
redaction, audit permissions, concurrency, and decision invariants have focused
coverage.

A release candidate also requires a fresh real-OMP smoke:

```bash
bun run build
bun run test:live
```

The live smoke uses the installed `omp` binary and may consume model quota. See
[Compatibility](./docs/compatibility.md) for the validated matrix.

## Security

Read [SECURITY.md](./SECURITY.md) before reporting a vulnerability and
[Threat model](./docs/threat-model.md) before relying on the extension in a
sensitive environment.

## Attribution

The policy design is inspired by OpenAI Codex Guardian. Its wording and
implementation are independent and do not reproduce Guardian text. See
[NOTICE](./NOTICE) and [LICENSE](./LICENSE).

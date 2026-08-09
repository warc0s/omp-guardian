# Configuration

Trusted global settings live at:

```text
~/.omp/agent/omp-approval-reviewer.jsonc
```

Repository hardening lives at:

```text
.omp/approval-reviewer.jsonc
```

## Trusted settings

- `reviewerModel`: `"current"` or an exact `provider/model` selector.
- `reviewerThinking`: `"current"`, `off`, `minimal`, `low`, `medium`, `high`,
  `xhigh`, `max`, or `auto`.
- `timeoutMs`: reviewer subprocess timeout.
- `confidenceThreshold`: minimum confidence for an automatic allow.
- `escalationMode`: `manual` or the stricter `deny`.
- `audit` and `auditPath`: audit enablement and destination.
- `policy`: custom trusted reviewer policy text.
- `reviewTools`, `reviewMcp`, and `reviewUnknownTools`: reviewed tool surfaces.
- `protectedPaths`: protected path globs with `!` exclusions.
- `trustedWriteRoots`: additional roots treated as trusted writes.
- `deniedBashExecutables`: executables rejected before inference.
- `autoAllowWorkspaceEdits`, `autoAllowReadOnlyBash`, and
  `autoAllowLocalTests`: deterministic fast paths.
- `reviewSubagentSpawns`: whether task/subagent creation itself needs review.

## Repository restrictions

Repository configuration may:

- raise the confidence threshold;
- add reviewed tools or protected paths;
- add denied executables;
- disable deterministic allow paths;
- enable review of subagent spawning;
- change escalation from `manual` to `deny`.

It cannot disable auditing, redirect the audit file, select a reviewer model,
lower confidence, remove protections, add trusted roots, or change `deny` back
to `manual`.

Malformed configuration fails back to conservative defaults.

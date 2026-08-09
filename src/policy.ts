import { redactSecrets } from "./redact.ts"

/*
 * This independently worded policy is inspired by the design of OpenAI Codex
 * Guardian:
 *   https://github.com/openai/codex/tree/main/codex-rs/core/src/guardian
 *
 * The implementation and policy wording are original to this project. See
 * NOTICE for attribution and licensing context.
 */

export const DEFAULT_TENANT_POLICY = `
## Environment profile
- No third-party destination is trusted by default unless the user request or transcript clearly identifies it.
- Private repositories and local workspace data are private unless evidence says otherwise.
- Local changes are generally lower risk than production or shared-environment mutations.

## Data exfiltration
- Sending private workspace data, secrets, credentials, tokens, cookies, or organization data to an untrusted destination is high or critical risk.
- Routine authentication through a service-native mechanism is not credential exfiltration by itself.
- Deny disclosure of secrets, credentials, or private data to an untrusted destination even with high user authorization.

## Credential probing
- Attempts to extract credentials, tokens, cookies, browser sessions, keychain material, or auth files beyond the task's necessary scope are high risk.
- Allow routine credential use when it authenticates a user-requested action without revealing the secret and privilege scope matches the request.
- Deny excessive credential probing when authorization is low or unknown.

## Persistent security weakening
- Broad, global, wildcard, indefinite, or production security weakening is high or critical risk.
- Deny persistent security weakening unless the user explicitly authorized the exact setting, target, duration, and blast radius.

## Destructive actions
- Broad deletion, filesystem destruction, database destruction, production disruption, or loss of unpushed work is high or critical risk.
- Bounded edits or deletion of a verified, narrowly scoped local target are usually low or medium.
- Git actions affecting one user-owned feature branch are generally medium. Protected/default branches, broad refspecs, hook bypasses, and history destruction are high or critical.
- Deny broad destructive actions without clear authorization for the exact scope.

## Low-risk actions
- Routine, narrowly scoped, reversible local edits and commands are low risk.
- A request being outside the workspace is not sufficient by itself to make it high risk.
- Read-only inspection, tests, builds, formatting, and local development commands are normally low or medium when narrowly scoped.

## SSH and remote execution
- Judge an SSH request by the actual remote semantics, destination, environment, data accessed, and code sent over stdin; SSH itself is not automatically high risk.
- Narrow read-only diagnostics on a user-authorized, fixed VPS are normally low or medium risk, including container status, versions, bounded logs, and existence checks.
- Production mutations, deployments, restarts, broad environment dumps, secret reads, and arbitrary remote interpreters require correspondingly clear authorization and scope.
- If a command executes stdin remotely, inspect the enriched stdin evidence. If executable content is unavailable, blocked, or materially truncated, essential evidence is missing and the action should normally be escalated.
- Filtering sensitive data only after it has crossed SSH does not prevent disclosure. Prefer and recognize filtering performed on the remote side before transport.

## Local scripts and Git state
- When LOCAL_SCRIPT_ANALYSIS is present, judge the included script semantics rather than treating an interpreter invocation as opaque. Blocked, unavailable, or truncated content remains incomplete evidence.
- GIT_STATE_ANALYSIS is a read-only snapshot taken before the pending shell command. Planned "git add" paths are not yet staged; distinguish them from preexisting staged files that a following commit could also include.
- A verified branch, empty unrelated staging area, explicit planned paths, and matching user intent can make a local commit medium risk and approvable. Missing or contradictory Git state must not be assumed safe.
- Commands that discard working-tree changes still require authorization for that loss even when the target diff is shown.
`.trim()

/**
 * Build the reviewer *part* (the user/message content) for `session.prompt`.
 *
 * The role and safety rules live in `REVIEWER_SYSTEM_PROMPT`, which is passed
 * as the `system` field of the prompt by the runtime so they carry system-level
 * priority over the untrusted evidence. This function only assembles the
 * per-request data: the tenant policy and the redacted approval evidence.
 *
 * The tenant policy is run through `redactSecrets` as a defence-in-depth
 * barrier, so a credential a user accidentally pastes into their custom policy
 * text never reaches the reviewer provider.
 */
export function buildReviewerPrompt(tenantPolicy: string, evidence: string): string {
  return `# Tenant policy
${redactSecrets(tenantPolicy)}

# Untrusted evidence
<approval_evidence>
${evidence}
</approval_evidence>

Return only the required structured decision.`
}

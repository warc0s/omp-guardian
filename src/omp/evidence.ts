import { analyzeCapability } from "../capability/bash-analyzer.ts"
import { parseCommand } from "../capability/command-parser.ts"
import { enrichGitEvidence } from "../git-evidence.ts"
import { enrichLocalScriptEvidence } from "../local-script-evidence.ts"
import { buildReviewerPrompt, DEFAULT_TENANT_POLICY } from "../policy.ts"
import { redactSecrets } from "../redact.ts"
import { enrichSshEvidence } from "../ssh-evidence.ts"
import type { PermissionRequest } from "../types.ts"
import { gatherSessionEvidence } from "./context.ts"
import type { OmpExtensionContext, OmpReviewerConfig } from "./types.ts"

export interface OmpEvidence {
  prompt: string
  preflightDenial?: string
  warnings: string[]
}

function bounded(value: string, max: number): string {
  const safe = redactSecrets(value)
  if (safe.length <= max) return safe
  return `${safe.slice(0, max)}\n<truncated characters="${safe.length - max}" />`
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, item) => (typeof item === "bigint" ? String(item) : item),
      2,
    )
  } catch {
    return JSON.stringify({ unavailable: "value could not be serialized" })
  }
}

export async function buildOmpEvidence(
  request: PermissionRequest,
  ctx: OmpExtensionContext,
  config: OmpReviewerConfig,
): Promise<OmpEvidence> {
  const warnings: string[] = []
  const session = gatherSessionEvidence(
    ctx.sessionManager,
    config.maxContextChars,
    config.transcriptMessages,
  )
  const fragments: string[] = []
  let preflightDenial: string | undefined

  if (request.permission === "bash") {
    const command = typeof request.metadata.command === "string" ? request.metadata.command : ""
    if (command.trim()) {
      try {
        const parsed = parseCommand(command)
        fragments.push(
          `CAPABILITY_ANALYSIS\n${stableJson(analyzeCapability(parsed, ctx.cwd, ctx.cwd))}`,
        )
      } catch {
        warnings.push("Static command capability analysis was unavailable.")
      }
    }

    const results = await Promise.allSettled([
      enrichGitEvidence(request, ctx.cwd, config.maxEnrichmentChars),
      enrichSshEvidence(request, ctx.cwd, ctx.cwd, config.maxEnrichmentChars),
      enrichLocalScriptEvidence(request, ctx.cwd, ctx.cwd, config.maxEnrichmentChars),
    ])
    for (const result of results) {
      if (result.status === "rejected") {
        warnings.push("An enrichment provider failed; treat evidence as incomplete.")
        continue
      }
      if (result.value.text) fragments.push(result.value.text)
      if ("preflightDenial" in result.value && result.value.preflightDenial) {
        preflightDenial = result.value.preflightDenial
      }
    }
  }

  const evidence = [
    `WORKING_DIRECTORY\n${ctx.cwd}`,
    `PENDING_TOOL_CALL\n${stableJson({
      tool: request.permission,
      arguments: request.metadata,
    })}`,
    `ACTION_ANALYSIS\n${fragments.join("\n\n") || "<none />"}`,
    `USER_INTENT_HISTORY\n${session.directIntent || "<unavailable />"}`,
    `RECENT_TRANSCRIPT\n${session.transcript || "<unavailable />"}`,
    warnings.length ? `EVIDENCE_WARNINGS\n${warnings.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")

  return {
    prompt: buildReviewerPrompt(
      config.policy ?? DEFAULT_TENANT_POLICY,
      bounded(evidence, config.maxEvidenceChars),
    ),
    ...(preflightDenial === undefined ? {} : { preflightDenial }),
    warnings,
  }
}

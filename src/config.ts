import type { EscalationMode, ReviewerConfig, RiskPolicy, UserAuthorization } from "./types.ts"

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  allow: {
    low: ["high", "medium", "low", "unknown"],
    medium: ["high", "medium", "low"],
    high: ["high", "medium"],
    critical: [],
  },
  minimumConfidence: 0.7,
  onInvalidDecision: "manual",
  onReviewerFailure: "manual",
}

export const DEFAULT_CONFIG: ReviewerConfig = {
  timeoutMs: 24_000,
  maxContextChars: 16_000,
  maxEnrichmentChars: 12_000,
  transcriptMessages: 16,
  confidenceThreshold: 0.7,
  audit: true,
  escalationMode: "manual",
  riskPolicy: DEFAULT_RISK_POLICY,
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

const VALID_AUTH = new Set(["high", "medium", "low", "unknown"])

function resolveRiskPolicy(value: unknown): RiskPolicy {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_RISK_POLICY, allow: { ...DEFAULT_RISK_POLICY.allow } }
  }
  const source = value as Record<string, unknown>
  const allowSource =
    typeof source.allow === "object" && source.allow !== null
      ? (source.allow as Record<string, unknown>)
      : {}
  const resolved: RiskPolicy = {
    allow: { ...DEFAULT_RISK_POLICY.allow },
    minimumConfidence: boundedNumber(
      source.minimumConfidence,
      DEFAULT_RISK_POLICY.minimumConfidence,
      0.5,
      1,
    ),
    onInvalidDecision: source.onInvalidDecision === "deny" ? "deny" : "manual",
    onReviewerFailure: source.onReviewerFailure === "deny" ? "deny" : "manual",
  }
  for (const risk of ["low", "medium", "high", "critical"] as const) {
    const cell = allowSource[risk]
    if (!Array.isArray(cell)) continue
    resolved.allow[risk] = cell.filter(
      (entry): entry is UserAuthorization => typeof entry === "string" && VALID_AUTH.has(entry),
    )
  }
  return resolved
}

function resolveEscalationMode(value: unknown): EscalationMode {
  return value === "deny" ? "deny" : "manual"
}

export function resolveConfig(options: Record<string, unknown> | undefined): ReviewerConfig {
  const source = options ?? {}
  const auditPath =
    typeof source.auditPath === "string" && source.auditPath.trim()
      ? source.auditPath.trim()
      : undefined
  const policy =
    typeof source.policy === "string" && source.policy.trim() ? source.policy.trim() : undefined
  return {
    timeoutMs: boundedInteger(source.timeoutMs, DEFAULT_CONFIG.timeoutMs, 5_000, 600_000),
    maxContextChars: boundedInteger(
      source.maxContextChars,
      DEFAULT_CONFIG.maxContextChars,
      4_000,
      200_000,
    ),
    maxEnrichmentChars: boundedInteger(
      source.maxEnrichmentChars,
      DEFAULT_CONFIG.maxEnrichmentChars,
      1_000,
      100_000,
    ),
    transcriptMessages: boundedInteger(
      source.transcriptMessages,
      DEFAULT_CONFIG.transcriptMessages,
      1,
      100,
    ),
    confidenceThreshold: boundedNumber(
      source.confidenceThreshold,
      DEFAULT_CONFIG.confidenceThreshold,
      0.5,
      1,
    ),
    audit: typeof source.audit === "boolean" ? source.audit : DEFAULT_CONFIG.audit,
    ...(auditPath === undefined ? {} : { auditPath }),
    ...(policy === undefined ? {} : { policy }),
    escalationMode: resolveEscalationMode(source.escalationMode),
    riskPolicy: resolveRiskPolicy(source.riskPolicy),
  }
}

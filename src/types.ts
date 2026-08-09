export type RiskLevel = "low" | "medium" | "high" | "critical"
export type UserAuthorization = "high" | "medium" | "low" | "unknown"
export type ReviewOutcome = "allow" | "deny" | "escalate"
export type ScopeAlignment = "aligned" | "partial" | "misaligned" | "unknown"
export type EvidenceSufficiency = "sufficient" | "partial" | "insufficient" | "unknown"
export type EscalationMode = "manual" | "deny"

export interface ReviewDecision {
  version: 2
  outcome: ReviewOutcome
  risk_level: RiskLevel
  user_authorization: UserAuthorization
  scope_alignment: ScopeAlignment
  evidence_completeness: EvidenceSufficiency
  rationale: string
  confidence: number
}

export interface PermissionToolSource {
  messageID: string
  callID: string
}

export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: PermissionToolSource
}

export interface RiskPolicy {
  allow: Record<RiskLevel, UserAuthorization[]>
  minimumConfidence: number
  onInvalidDecision: "manual" | "deny"
  onReviewerFailure: "manual" | "deny"
}

export interface ReviewerConfig {
  timeoutMs: number
  maxContextChars: number
  maxEnrichmentChars: number
  transcriptMessages: number
  confidenceThreshold: number
  audit: boolean
  auditPath?: string
  policy?: string
  escalationMode: EscalationMode
  riskPolicy: RiskPolicy
}

export type DecisionSource =
  "emergency-brake" | "deterministic-policy" | "llm-reviewer" | "failure-safe"

export interface ReviewExecutionResult {
  kind: "allow" | "deny" | "escalate"
  decision?: ReviewDecision
  reason: string
  decisionSource?: DecisionSource
  reviewerOutcome?: ReviewOutcome
}

export interface ReviewAuditRecord {
  schemaVersion: number
  decisionSchemaVersion: number
  promptVersion: string
  decisionSource: DecisionSource
  timestamp: string
  durationMs: number
  requestID: string
  sessionID: string
  permission: string
  actionHash: string
  outcome: ReviewExecutionResult["kind"]
  reason: string
  riskLevel?: RiskLevel
  userAuthorization?: UserAuthorization
  scopeAlignment?: ScopeAlignment
  confidence?: number
  reviewerOutcome?: ReviewOutcome
  reviewerModel: string
  warnings?: string[]
}

export type EvidenceConfidence = "confirmed" | "high" | "medium" | "low" | "unknown"

export interface Provenanced<T> {
  value: T
  source:
    | "permission-event"
    | "tool-message"
    | "session-api"
    | "parent-session"
    | "global-config"
    | "project-config"
    | "effective-permissions"
    | "static-analysis"
    | "heuristic"
    | "unavailable"
  confidence: EvidenceConfidence
  notes?: string[]
}

export type ParserCompleteness = "complete-for-supported-form" | "partial" | "opaque"

export interface Redirection {
  operator: string
  target: string
  quoted: boolean
}

export interface HeredocRecord {
  delimiter: string
  operator: string
  expansionDisabled: boolean
  bodyBounded: string
  bodySha256: string
  truncated: boolean
  outputTarget?: string
  dynamic: boolean
}

export interface ParsedCommand {
  sanitizedCommand: string
  segments: import("./shell-lexer.ts").ShellSegment[]
  effective: import("./shell-lexer.ts").ShellToken[][]
  redirections: Redirection[][]
  heredocs: HeredocRecord[]
  hasDynamicConstructs: boolean
}

export type CapabilityActionClass =
  | "read-only"
  | "workspace-write"
  | "temporary-write"
  | "external-write"
  | "destruction"
  | "code-execution"
  | "package-management"
  | "git-mutation"
  | "network"
  | "remote-operation"
  | "service-management"
  | "persistence"
  | "privilege-escalation"
  | "unknown"

export interface CapabilityAssessment {
  actionClass: Provenanced<CapabilityActionClass>
  summary: string
  executesCode: Provenanced<boolean | "unknown">
  executesRepositoryCode: Provenanced<boolean | "unknown">
  createsAdHocCode: Provenanced<boolean | "unknown">
  invokesExistingTestRunner: Provenanced<boolean | "unknown">
  invokesPackageLifecycleScripts: Provenanced<boolean | "unknown">
  writeEffects: {
    temporaryWrite: Provenanced<boolean | "unknown">
    workspaceWrite: Provenanced<boolean | "unknown">
    externalWrite: Provenanced<boolean | "unknown">
    deletion: Provenanced<boolean | "unknown">
  }
  network: {
    observed: Provenanced<boolean | "unknown">
    possible: Provenanced<boolean | "unknown">
    destinations: string[]
    observedAccess: Provenanced<boolean | "unknown">
    possibleAccess: Provenanced<boolean | "unknown">
  }
  process: {
    childProcesses: Provenanced<boolean | "unknown">
    persistence: Provenanced<boolean | "unknown">
    privilegeEscalation: Provenanced<boolean | "unknown">
  }
  remote: {
    enabled: Provenanced<boolean | "unknown">
    mutationHint: Provenanced<boolean | "unknown">
  }
  git: {
    observed: Provenanced<boolean | "unknown">
    possible: Provenanced<boolean | "unknown">
    observedAccess: Provenanced<boolean | "unknown">
    possibleAccess: Provenanced<boolean | "unknown">
  }
  parserCompleteness: ParserCompleteness
  analysisWarnings: string[]
}

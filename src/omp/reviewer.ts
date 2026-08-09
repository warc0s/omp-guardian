import { DECISION_SCHEMA_VERSION, enforceDecision, parseDecision } from "../decision.ts"
import { emergencyBrakeReason } from "../emergency-brake.ts"
import { redactSecrets } from "../redact.ts"
import type {
  DecisionSource,
  PermissionRequest,
  ReviewAuditRecord,
  ReviewExecutionResult,
} from "../types.ts"
import { createOmpAuditWriter } from "./audit.ts"
import { buildOmpEvidence } from "./evidence.ts"
import { requestActionHash } from "./request.ts"
import type {
  OmpExtensionContext,
  OmpModel,
  OmpReviewerConfig,
  ReviewerInvoker,
  ThinkingLevel,
} from "./types.ts"

const PROMPT_VERSION = "omp-guardian"

function resolveReviewerModel(
  configured: OmpReviewerConfig["reviewerModel"],
  active: OmpModel | undefined,
): OmpModel | undefined {
  if (configured === "current") return active
  const slash = configured.indexOf("/")
  return {
    provider: configured.slice(0, slash),
    id: configured.slice(slash + 1),
  }
}

export class OmpApprovalReviewer {
  private readonly writeAudit: (record: ReviewAuditRecord) => Promise<void>

  constructor(
    private readonly config: OmpReviewerConfig,
    private readonly invoker: ReviewerInvoker,
  ) {
    this.writeAudit = createOmpAuditWriter(config)
  }

  async recordDeterministicDenial(
    request: PermissionRequest,
    ctx: OmpExtensionContext,
    reason: string,
    source: "emergency-brake" | "deterministic-policy",
  ): Promise<void> {
    const reviewerModel = resolveReviewerModel(this.config.reviewerModel, ctx.model)
    await this.writeAudit({
      schemaVersion: 2,
      decisionSchemaVersion: DECISION_SCHEMA_VERSION,
      promptVersion: PROMPT_VERSION,
      decisionSource: source,
      timestamp: new Date().toISOString(),
      durationMs: 0,
      requestID: request.id,
      sessionID: request.sessionID,
      permission: request.permission,
      actionHash: requestActionHash(request),
      outcome: "deny",
      reason,
      reviewerModel: reviewerModel
        ? `${reviewerModel.provider}/${reviewerModel.id}`
        : "unavailable",
    })
  }

  async review(
    request: PermissionRequest,
    ctx: OmpExtensionContext,
    thinkingLevel: ThinkingLevel,
    signal?: AbortSignal,
  ): Promise<ReviewExecutionResult> {
    const started = performance.now()
    let result: ReviewExecutionResult
    let source: DecisionSource = "failure-safe"
    let warnings: string[] = []
    const reviewerModel = resolveReviewerModel(this.config.reviewerModel, ctx.model)
    const reviewerThinking =
      this.config.reviewerThinking === "current" ? thinkingLevel : this.config.reviewerThinking
    const modelName = reviewerModel
      ? `${reviewerModel.provider}/${reviewerModel.id}`
      : "unavailable"

    const brake = emergencyBrakeReason(request)
    if (brake) {
      result = { kind: "deny", reason: brake }
      source = "emergency-brake"
    } else if (!reviewerModel) {
      result = { kind: "escalate", reason: "No active OMP model is available for review." }
    } else {
      try {
        const evidence = await buildOmpEvidence(request, ctx, this.config)
        warnings = evidence.warnings
        if (evidence.preflightDenial) {
          result = { kind: "deny", reason: evidence.preflightDenial }
          source = "deterministic-policy"
        } else {
          const raw = await this.invoker.invoke({
            model: reviewerModel,
            thinkingLevel: reviewerThinking,
            prompt: evidence.prompt,
            timeoutMs: this.config.timeoutMs,
            cwd: ctx.cwd,
            ...(signal === undefined ? {} : { signal }),
          })
          const decision = parseDecision(raw)
          if (!decision) {
            result = {
              kind: "escalate",
              reason: "Reviewer returned an invalid structured decision.",
            }
          } else {
            result = enforceDecision(decision, this.config)
            source = "llm-reviewer"
          }
        }
      } catch (error) {
        const message = redactSecrets(error instanceof Error ? error.message : String(error))
        result = { kind: "escalate", reason: `Reviewer failed safely: ${message}` }
      }
    }

    if (result.kind === "escalate" && this.config.escalationMode === "deny") {
      result = { ...result, kind: "deny", reason: `Escalation denied by policy: ${result.reason}` }
    }

    result = { ...result, decisionSource: source }

    const decision = result.decision
    await this.writeAudit({
      schemaVersion: 2,
      decisionSchemaVersion: DECISION_SCHEMA_VERSION,
      promptVersion: PROMPT_VERSION,
      decisionSource: source,
      timestamp: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      requestID: request.id,
      sessionID: request.sessionID,
      permission: request.permission,
      actionHash: requestActionHash(request),
      outcome: result.kind,
      reason: result.reason,
      ...(decision === undefined
        ? {}
        : {
            riskLevel: decision.risk_level,
            userAuthorization: decision.user_authorization,
            scopeAlignment: decision.scope_alignment,
            confidence: decision.confidence,
            reviewerOutcome: decision.outcome,
          }),
      reviewerModel: modelName,
      ...(warnings.length ? { warnings } : {}),
    })
    return result
  }
}

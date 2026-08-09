import type { ReviewExecutionResult } from "../types.ts"
import { redactSecrets } from "../redact.ts"
import {
  displaySourceForDecision,
  guardianErrorPrefix,
  renderGuardianBashCall,
  renderGuardianBashResult,
  withGuardianDetails,
  type GuardianDisplayDetails,
  type GuardianDisplaySource,
} from "./bash-renderer.ts"
import { loadOmpConfig } from "./config.ts"
import { OmpProcessReviewerInvoker } from "./invoker.ts"
import { requestFromToolCall } from "./request.ts"
import { OmpApprovalReviewer } from "./reviewer.ts"
import { routeBashCommand, routeToolCall } from "./routing.ts"
import type {
  OmpExtensionApi,
  OmpExtensionContext,
  OmpReviewerConfig,
  OmpToolCallEvent,
  ReviewerInvoker,
  ThinkingLevel,
} from "./types.ts"

const MAX_CONSECUTIVE_DENIALS = 3
const MAX_TOTAL_DENIALS = 20

interface DenialState {
  consecutive: number
  total: number
  tripped: boolean
}

export async function shouldReviewTool(
  event: OmpToolCallEvent,
  cwd: string,
  config: OmpReviewerConfig,
): Promise<boolean> {
  if (event.toolName === "bash") return false
  const ctx = { cwd, hasUI: false, ui: {}, sessionManager: {} }
  return (await routeToolCall(event, ctx, config)).route === "review"
}

async function applyDisposition(
  result: ReviewExecutionResult,
  ctx: OmpExtensionContext,
): Promise<{ source: GuardianDisplaySource; block?: true; reason?: string }> {
  const source = displaySourceForDecision(result.decisionSource)
  if (result.kind === "allow") return { source }
  if (result.kind === "deny") {
    return { source, block: true, reason: `${guardianErrorPrefix(source)} ${result.reason}` }
  }
  if (!ctx.hasUI) {
    return {
      source,
      block: true,
      reason: `${guardianErrorPrefix(source)} Manual review unavailable; blocked safely. ${result.reason}`,
    }
  }
  let approved = false
  if (ctx.ui.select) {
    const choice = await ctx.ui.select("OMP Guardian requires manual approval", [
      "Deny (recommended)",
      "Allow once",
    ])
    approved = choice === "Allow once"
  } else if (ctx.ui.confirm) {
    approved = await ctx.ui.confirm("OMP Guardian requires manual approval", result.reason)
  }
  return approved
    ? { source: "manual" }
    : { source: "manual", block: true, reason: `${guardianErrorPrefix("manual")} ${result.reason}` }
}

function reviewerDisplayDetails(
  source: GuardianDisplaySource,
  config: OmpReviewerConfig,
  ctx: OmpExtensionContext,
  thinking: ThinkingLevel,
): GuardianDisplayDetails {
  if (source !== "LLM") return { source }
  const model =
    config.reviewerModel === "current"
      ? ctx.model
        ? `${ctx.model.provider}/${ctx.model.id}`
        : "unavailable"
      : config.reviewerModel
  const reviewerThinking =
    config.reviewerThinking === "current" ? thinking : config.reviewerThinking
  return { source, model, thinking: reviewerThinking === "auto" ? "max" : reviewerThinking }
}

export interface OmpRuntimeOptions {
  invoker?: ReviewerInvoker
  loadConfig?: (cwd: string) => OmpReviewerConfig
}

export function installOmpApprovalReviewer(
  pi: OmpExtensionApi,
  options: OmpRuntimeOptions = {},
): void {
  if (process.env.OMP_APPROVAL_REVIEWER_CHILD === "1") return
  const invoker = options.invoker ?? new OmpProcessReviewerInvoker()
  const configFor = options.loadConfig ?? loadOmpConfig
  const reviewers = new Map<string, OmpApprovalReviewer>()
  const denials = new Map<string, DenialState>()
  const sessionKey = (ctx: OmpExtensionContext) => ctx.sessionManager.getSessionId?.() ?? ctx.cwd
  const markAllowed = (ctx: OmpExtensionContext) => {
    const state = denials.get(sessionKey(ctx))
    if (state) state.consecutive = 0
  }
  const markDenied = (ctx: OmpExtensionContext): string => {
    const key = sessionKey(ctx)
    const state = denials.get(key) ?? { consecutive: 0, total: 0, tripped: false }
    state.consecutive += 1
    state.total += 1
    denials.set(key, state)
    if (
      !state.tripped &&
      (state.consecutive >= MAX_CONSECUTIVE_DENIALS || state.total >= MAX_TOTAL_DENIALS)
    ) {
      state.tripped = true
      const reason =
        state.consecutive >= MAX_CONSECUTIVE_DENIALS
          ? `${state.consecutive} consecutive denied operations`
          : `${state.total} denied operations in this session`
      ctx.ui.notify?.(
        `[OMP Guardian] Safety circuit breaker: ${reason}; stopping the turn.`,
        "error",
      )
      ctx.abort?.()
      return ` Safety circuit breaker stopped the turn after ${reason}.`
    }
    return ""
  }
  const reviewerFor = (cwd: string) => {
    let reviewer = reviewers.get(cwd)
    if (!reviewer) {
      reviewer = new OmpApprovalReviewer(configFor(cwd), invoker)
      reviewers.set(cwd, reviewer)
    }
    return reviewer
  }
  const thinking = () => pi.getThinkingLevel() ?? "max"

  pi.registerTool({
    name: "bash",
    label: "Bash (OMP Guardian)",
    description: "Execute a shell command after an independent safety and authorization review.",
    parameters: pi.zod.object({
      command: pi.zod.string().describe("Shell command to execute"),
      timeout: pi.zod.number().optional().describe("Optional timeout in seconds"),
    }),
    approval: {
      tier: "exec",
      policy: "allow",
      reason: "Execution is gated by OMP Guardian before native Bash is invoked.",
    },
    mergeCallAndResult: true,
    renderCall: renderGuardianBashCall,
    renderResult: renderGuardianBashResult,
    execute: async (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: OmpExtensionContext,
    ) => {
      const event: OmpToolCallEvent = {
        type: "tool_call",
        toolName: "bash",
        toolCallId,
        input: params,
      }
      const request = requestFromToolCall(event, ctx)
      const config = configFor(ctx.cwd)
      const routing = await routeBashCommand(event, ctx, config)
      if (routing.route === "deny") {
        await reviewerFor(ctx.cwd).recordDeterministicDenial(
          request,
          ctx,
          routing.reason,
          routing.reason.startsWith("Emergency brake") ? "emergency-brake" : "deterministic-policy",
        )
        throw new Error(
          `${guardianErrorPrefix("deterministic")} ${routing.reason}${markDenied(ctx)}`,
        )
      }
      const activeThinking = thinking()
      const result =
        routing.route === "review"
          ? await reviewerFor(ctx.cwd).review(request, ctx, activeThinking, signal)
          : {
              kind: "allow" as const,
              reason: routing.reason,
              decisionSource: "deterministic-policy" as const,
            }
      const disposition = await applyDisposition(result, ctx)
      if (disposition.block) throw new Error(`${disposition.reason}${markDenied(ctx)}`)
      markAllowed(ctx)
      if (!ctx.invokeTool)
        throw new Error(
          `${guardianErrorPrefix("fail-safe")} Native Bash delegation is unavailable; blocked safely.`,
        )
      const guardian = reviewerDisplayDetails(disposition.source, config, ctx, activeThinking)
      const guardedUpdate =
        typeof onUpdate === "function"
          ? (update: unknown) =>
              (onUpdate as (value: unknown) => void)(withGuardianDetails(update, guardian))
          : onUpdate
      try {
        const nativeResult = await ctx.invokeTool(params, {
          ...(signal === undefined ? {} : { signal }),
          ...(guardedUpdate === undefined ? {} : { onUpdate: guardedUpdate }),
        })
        return withGuardianDetails(nativeResult, guardian)
      } catch (error) {
        const prefix = guardianErrorPrefix(disposition.source)
        if (error instanceof Error) {
          if (!error.message.includes(prefix)) error.message = `${prefix} ${error.message}`
          throw error
        }
        throw new Error(`${prefix} ${String(error)}`, { cause: error })
      }
    },
  })

  pi.on("tool_call", async (event, ctx) => {
    try {
      const config = configFor(ctx.cwd)
      if (event.toolName === "bash") return
      const routing = await routeToolCall(event, ctx, config)
      if (routing.route === "allow") {
        markAllowed(ctx)
        return
      }
      if (routing.route === "deny") {
        await reviewerFor(ctx.cwd).recordDeterministicDenial(
          requestFromToolCall(event, ctx),
          ctx,
          routing.reason,
          "deterministic-policy",
        )
        return { block: true, reason: `[OMP Guardian] ${routing.reason}${markDenied(ctx)}` }
      }
      const result = await reviewerFor(ctx.cwd).review(
        requestFromToolCall(event, ctx),
        ctx,
        thinking(),
      )
      const disposition = await applyDisposition(result, ctx)
      if (disposition.block) {
        return { block: true, reason: `${disposition.reason}${markDenied(ctx)}` }
      }
      markAllowed(ctx)
      return
    } catch (error) {
      const reason = redactSecrets(error instanceof Error ? error.message : String(error))
      return { block: true, reason: `[OMP Guardian] Reviewer error; blocked safely. ${reason}` }
    }
  })

  pi.on("session_shutdown", () => {
    denials.clear()
    invoker.dispose()
  })
}

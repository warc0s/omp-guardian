import type { ReviewExecutionResult, ReviewerConfig } from "../types.ts"

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "auto"

export type ReviewerModelSelection = "current" | `${string}/${string}`
export type ReviewerThinkingSelection = "current" | ThinkingLevel

export interface OmpModel {
  provider: string
  id: string
}

export interface OmpSessionManager {
  getSessionId?(): string
  getBranch?(): unknown[]
  getEntries?(): unknown[]
}

export interface OmpUi {
  select?(title: string, choices: string[]): Promise<string | undefined>
  confirm?(title: string, body: string): Promise<boolean>
  setStatus?(key: string, text?: string): void
  notify?(message: string, type?: "info" | "warning" | "error"): void
}

export interface OmpExtensionContext {
  ui: OmpUi
  hasUI: boolean
  cwd: string
  sessionManager: OmpSessionManager
  model?: OmpModel
  abort?(): void
  invokeTool?(
    params: Record<string, unknown>,
    options?: { signal?: AbortSignal; onUpdate?: unknown },
  ): Promise<unknown>
}

export interface OmpToolCallEvent {
  type: "tool_call"
  toolName: string
  toolCallId: string
  input: Record<string, unknown>
}

export interface OmpExtensionApi {
  zod: {
    object(shape: Record<string, unknown>): unknown
    string(): { describe(text: string): unknown }
    number(): { optional(): { describe(text: string): unknown } }
  }
  registerTool(tool: Record<string, unknown>): void
  on(
    event: "tool_call",
    handler: (
      event: OmpToolCallEvent,
      ctx: OmpExtensionContext,
    ) => Promise<void | { block: true; reason: string }>,
  ): void
  on(event: "session_shutdown", handler: () => Promise<void> | void): void
  getThinkingLevel(): ThinkingLevel | undefined
}

export interface OmpReviewerConfig extends ReviewerConfig {
  reviewerModel: ReviewerModelSelection
  reviewerThinking: ReviewerThinkingSelection
  reviewTools: string[]
  protectedPaths: string[]
  reviewMcp: boolean
  reviewUnknownTools: boolean
  maxEvidenceChars: number
  autoAllowWorkspaceEdits: boolean
  autoAllowReadOnlyBash: boolean
  autoAllowLocalTests: boolean
  reviewSubagentSpawns: boolean
  trustedWriteRoots: string[]
  deniedBashExecutables: string[]
}

export interface ReviewInvocation {
  model: OmpModel
  thinkingLevel: ThinkingLevel
  prompt: string
  timeoutMs: number
  cwd: string
  signal?: AbortSignal
}

export interface ReviewerInvoker {
  invoke(request: ReviewInvocation): Promise<unknown>
  dispose(): void
}

export interface ReviewOutcomeWithMetadata {
  result: ReviewExecutionResult
  reviewerModel: string
  thinkingLevel: ThinkingLevel
  durationMs: number
}

export interface OmpReviewResult extends ReviewOutcomeWithMetadata {
  requestID: string
}

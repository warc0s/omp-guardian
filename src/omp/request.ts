import { createHash } from "node:crypto"
import type { PermissionRequest } from "../types.ts"
import type { OmpExtensionContext, OmpToolCallEvent } from "./types.ts"

const MAX_PATTERN_CHARS = 12_000

function boundedJson(value: unknown): string {
  let text: string
  try {
    text = JSON.stringify(value)
  } catch {
    text = "[unserializable input]"
  }
  return text.length <= MAX_PATTERN_CHARS ? text : `${text.slice(0, MAX_PATTERN_CHARS)}…`
}

function primaryPattern(event: OmpToolCallEvent): string {
  if (event.toolName === "bash" && typeof event.input.command === "string") {
    return event.input.command
  }
  if (
    (event.toolName === "write" ||
      event.toolName === "edit" ||
      event.toolName === "delete" ||
      event.toolName === "move") &&
    typeof event.input.path === "string"
  ) {
    return event.input.path
  }
  return boundedJson(event.input)
}

export function requestFromToolCall(
  event: OmpToolCallEvent,
  ctx: OmpExtensionContext,
): PermissionRequest {
  return {
    id: event.toolCallId,
    sessionID: ctx.sessionManager.getSessionId?.() ?? "unknown-session",
    permission: event.toolName,
    patterns: [primaryPattern(event)],
    metadata: { ...event.input, cwd: ctx.cwd },
    always: [],
    tool: { messageID: "omp-tool-call", callID: event.toolCallId },
  }
}

export function requestActionHash(request: PermissionRequest): string {
  const canonical = JSON.stringify({
    permission: request.permission,
    patterns: [...request.patterns].sort(),
    metadata: request.metadata,
  })
  return createHash("sha256").update(canonical).digest("hex")
}

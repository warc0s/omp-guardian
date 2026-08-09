import type { OmpSessionManager } from "./types.ts"
import { redactSecrets } from "../redact.ts"

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .flatMap((block) => {
      if (typeof block !== "object" || block === null) return []
      const record = block as Record<string, unknown>
      return record.type === "text" && typeof record.text === "string" ? [record.text] : []
    })
    .join("\n")
}

function messageFromEntry(entry: unknown): { role: string; text: string } | undefined {
  if (typeof entry !== "object" || entry === null) return
  const record = entry as Record<string, unknown>
  const rawMessage = record.type === "message" ? record.message : record
  if (typeof rawMessage !== "object" || rawMessage === null) return
  const message = rawMessage as Record<string, unknown>
  if (typeof message.role !== "string") return
  const text = textFromContent(message.content)
  if (!text.trim()) return
  return { role: message.role, text }
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n[truncated]`
}

export interface SessionEvidence {
  directIntent: string
  transcript: string
}

export function gatherSessionEvidence(
  session: OmpSessionManager,
  maxChars: number,
  maxMessages: number,
): SessionEvidence {
  const entries = session.getBranch?.() ?? session.getEntries?.() ?? []
  const messages = entries.map(messageFromEntry).filter((item) => item !== undefined)
  const userMessages = messages.filter((message) => message.role === "user")
  const directIntent = bounded(
    redactSecrets(userMessages.map((message) => message.text).join("\n---\n")),
    Math.floor(maxChars / 2),
  )
  const transcript = bounded(
    redactSecrets(
      messages
        .slice(-maxMessages)
        .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
        .join("\n\n"),
    ),
    maxChars,
  )
  return { directIntent, transcript }
}

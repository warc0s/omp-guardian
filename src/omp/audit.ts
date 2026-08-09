import { appendFile, chmod, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import { redactSecrets } from "../redact.ts"
import type { ReviewAuditRecord } from "../types.ts"
import type { OmpReviewerConfig } from "./types.ts"

export function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2))
  return resolve(path)
}

function safeReason(reason: string): string {
  const value = redactSecrets(reason)
    .replace(/[\r\n]+/g, " ")
    .trim()
  return value.length <= 2_000 ? value : `${value.slice(0, 2_000)}…`
}

export function createOmpAuditWriter(
  config: OmpReviewerConfig,
): (record: ReviewAuditRecord) => Promise<void> {
  if (!config.audit) return async () => {}
  const path = expandHome(config.auditPath!)
  let ready: Promise<void> | undefined
  return async (record) => {
    ready ??= mkdir(dirname(path), { recursive: true }).then(async () => {
      try {
        await chmod(dirname(path), 0o700)
      } catch {
        // Existing parent ownership or platform semantics may prevent chmod.
      }
    })
    await ready
    await appendFile(
      path,
      `${JSON.stringify({ ...record, reason: safeReason(record.reason) })}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    )
    await chmod(path, 0o600)
  }
}

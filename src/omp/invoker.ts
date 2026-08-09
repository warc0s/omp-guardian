import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { basename, delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ReviewInvocation, ReviewerInvoker } from "./types.ts"

const MAX_OUTPUT_BYTES = 1024 * 1024

function isOmpBinary(path: string): boolean {
  const name = basename(path).toLowerCase()
  return name === "omp" || name === "omp.exe"
}

function executableOnPath(name: string): string | undefined {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, name)
    if (existsSync(candidate)) return candidate
  }
  return
}

export function resolveOmpBinary(): string {
  const explicit = process.env.OMP_APPROVAL_REVIEWER_HOST
  if (explicit && existsSync(explicit)) return explicit
  if (isOmpBinary(process.execPath)) return process.execPath
  const argvCandidate = process.argv.find((entry) => isOmpBinary(entry) && existsSync(entry))
  if (argvCandidate) return argvCandidate
  return executableOnPath(process.platform === "win32" ? "omp.exe" : "omp") ?? "omp"
}

export function reviewerSystemPromptPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(moduleDir, "../../assets/reviewer-system.md"),
    resolve(moduleDir, "../assets/reviewer-system.md"),
    resolve(process.cwd(), "assets/reviewer-system.md"),
  ]
  const found = candidates.find(existsSync)
  if (!found) throw new Error("Reviewer system prompt asset is missing")
  return found
}

function parseJsonOutput(text: string): unknown {
  const trimmed = text.trim()
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
  try {
    return JSON.parse(unfenced)
  } catch {
    const start = unfenced.indexOf("{")
    const end = unfenced.lastIndexOf("}")
    if (start < 0 || end <= start) return
    try {
      return JSON.parse(unfenced.slice(start, end + 1))
    } catch {
      return
    }
  }
}

function appendBounded(current: string, chunk: Buffer): string {
  if (Buffer.byteLength(current) >= MAX_OUTPUT_BYTES) return current
  const available = MAX_OUTPUT_BYTES - Buffer.byteLength(current)
  return current + chunk.subarray(0, available).toString("utf8")
}

function terminate(proc: ChildProcess): void {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  proc.kill("SIGTERM")
  const timer = setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL")
  }, 2_000)
  timer.unref()
}

export class OmpProcessReviewerInvoker implements ReviewerInvoker {
  private readonly children = new Set<ChildProcess>()

  async invoke(request: ReviewInvocation): Promise<unknown> {
    const binary = resolveOmpBinary()
    const systemPrompt = reviewerSystemPromptPath()
    const model = `${request.model.provider}/${request.model.id}`
    const thinking = request.thinkingLevel === "auto" ? "max" : request.thinkingLevel
    const maxSeconds = Math.max(5, Math.ceil(request.timeoutMs / 1_000))
    const args = [
      "-p",
      request.prompt,
      "--model",
      model,
      "--thinking",
      thinking,
      "--system-prompt",
      systemPrompt,
      "--no-tools",
      "--no-session",
      "--no-lsp",
      "--no-skills",
      "--no-rules",
      "--no-title",
      "--no-prewalk",
      "--no-pty",
      "--max-time",
      String(maxSeconds),
    ]
    const proc = spawn(binary, args, {
      cwd: request.cwd,
      env: { ...process.env, OMP_APPROVAL_REVIEWER_CHILD: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    this.children.add(proc)
    let stdout = ""
    let stderr = ""
    proc.stdout!.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk)
    })
    proc.stderr!.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk)
    })

    return await new Promise<unknown>((resolvePromise, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        request.signal?.removeEventListener("abort", onAbort)
        this.children.delete(proc)
        callback()
      }
      const timeout = setTimeout(() => {
        terminate(proc)
        finish(() => reject(new Error(`Reviewer timed out after ${request.timeoutMs}ms`)))
      }, request.timeoutMs)
      const onAbort = () => {
        terminate(proc)
        finish(() => reject(new Error("Reviewer aborted")))
      }
      request.signal?.addEventListener("abort", onAbort, { once: true })
      if (request.signal?.aborted) onAbort()
      proc.on("error", (error) => finish(() => reject(error)))
      proc.on("exit", (code, signal) => {
        finish(() => {
          if (code !== 0) {
            const detail = stderr
              .trim()
              .slice(-800)
              .replace(/[\r\n]+/g, " ")
            reject(
              new Error(
                `Reviewer process failed (${signal ?? code ?? "unknown"})${detail ? `: ${detail}` : ""}`,
              ),
            )
            return
          }
          const parsed = parseJsonOutput(stdout)
          if (parsed === undefined) {
            reject(new Error("Reviewer returned invalid JSON"))
            return
          }
          resolvePromise(parsed)
        })
      })
    })
  }

  dispose(): void {
    for (const child of this.children) terminate(child)
    this.children.clear()
  }
}

export { parseJsonOutput }

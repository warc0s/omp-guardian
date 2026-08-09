import type { DecisionSource } from "../types.ts"

export type GuardianDisplaySource = "deterministic" | "LLM" | "manual" | "fail-safe"

export interface GuardianDisplayDetails {
  source: GuardianDisplaySource
  model?: string
  thinking?: string
}

interface ToolResultLike {
  content?: Array<{ type?: string; text?: string }>
  details?: unknown
  isError?: boolean
}

interface RenderOptions {
  expanded?: boolean
}

interface ThemeLike {
  bold?(text: string): string
  fg?(token: string, text: string): string
}

interface RenderComponent {
  render(width: number): readonly string[]
}

const DETAILS_KEY = "ompGuardian"
const ERROR_SOURCE = /\[OMP Guardian · (deterministic|LLM|manual|fail-safe)\]/

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function cleanLine(value: string): string {
  return [...value.replace(/\t/g, "  ")]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0
      return code >= 32 && code !== 127
    })
    .join("")
}

function truncate(value: string, width: number): string {
  if (width <= 1) return value.slice(0, Math.max(0, width))
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`
}

function style(theme: ThemeLike, token: string, value: string, bold = false): string {
  const emphasized = bold && theme.bold ? theme.bold(value) : value
  return theme.fg ? theme.fg(token, emphasized) : emphasized
}

function component(lines: string[], theme: ThemeLike, titleToken = "toolTitle"): RenderComponent {
  return {
    render(width) {
      const safeWidth = Math.max(1, width)
      return lines.map((line, index) => {
        const clipped = truncate(cleanLine(line), safeWidth)
        return index === 0
          ? style(theme, titleToken, clipped, true)
          : style(theme, "toolOutput", clipped)
      })
    },
  }
}

function commandFrom(args: unknown): string {
  const command = asRecord(args)?.command
  return typeof command === "string" && command.trim() ? command : "bash"
}

function textOutput(result: ToolResultLike): string {
  return (result.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
}

function stripTrailingNotice(value: string, notice: string): string {
  if (!value.trimEnd().endsWith(notice)) return value
  const end = value.trimEnd().length - notice.length
  return value.slice(0, end).trimEnd()
}

function displayDetails(result: ToolResultLike): GuardianDisplayDetails {
  const details = asRecord(result.details)
  const guardian = asRecord(details?.[DETAILS_KEY])
  const source = guardian?.source
  if (
    guardian &&
    (source === "deterministic" ||
      source === "LLM" ||
      source === "manual" ||
      source === "fail-safe")
  ) {
    return {
      source,
      ...(typeof guardian.model === "string" ? { model: guardian.model } : {}),
      ...(typeof guardian.thinking === "string" ? { thinking: guardian.thinking } : {}),
    }
  }
  const match = textOutput(result).match(ERROR_SOURCE)
  return { source: (match?.[1] as GuardianDisplaySource | undefined) ?? "fail-safe" }
}

function resultLines(
  result: ToolResultLike,
  options: RenderOptions,
  args: unknown,
): { lines: string[]; source: GuardianDisplaySource } {
  const guardian = displayDetails(result)
  const lines = [`Bash (OMP Guardian · ${guardian.source})`, `└─ command=${commandFrom(args)}`]
  if (guardian.source === "LLM" && guardian.model) {
    lines.push(
      `   reviewer=${guardian.model}${guardian.thinking ? ` · reasoning=${guardian.thinking}` : ""}`,
    )
  }
  const details = asRecord(result.details)
  let output = textOutput(result)
  if (typeof details?.wallTimeMs === "number" && Number.isFinite(details.wallTimeMs)) {
    output = stripTrailingNotice(
      output,
      `Wall time: ${(details.wallTimeMs / 1_000).toFixed(2)} seconds`,
    )
  }
  if (output) {
    const outputLines = output.split(/\r?\n/)
    const limit = options.expanded ? outputLines.length : 12
    lines.push(...outputLines.slice(0, limit))
    if (outputLines.length > limit) {
      lines.push(`… ${outputLines.length - limit} more lines [Ctrl+O: Expand]`)
    }
  }
  const stats: string[] = []
  if (typeof details?.wallTimeMs === "number" && Number.isFinite(details.wallTimeMs)) {
    stats.push(`Wall: ${(details.wallTimeMs / 1_000).toFixed(2)}s`)
  }
  if (details?.timeoutDisabled === true) {
    stats.push("Timeout: disabled")
  } else if (typeof details?.timeoutSeconds === "number") {
    const requested = details.requestedTimeoutSeconds
    stats.push(
      typeof requested === "number" && requested !== details.timeoutSeconds
        ? `Timeout: ${details.timeoutSeconds}s (requested ${requested}s clamped)`
        : `Timeout: ${details.timeoutSeconds}s`,
    )
  }
  if (result.isError && typeof details?.exitCode === "number") {
    stats.push(`Exit: ${details.exitCode}`)
  }
  const asyncDetails = asRecord(details?.async)
  if (asyncDetails?.state === "running" && typeof asyncDetails.jobId === "string") {
    stats.push(`Backgrounded: ${asyncDetails.jobId}`)
  }
  if (stats.length) lines.push(`⟦${stats.join(" | ")}⟧`)
  return { lines, source: guardian.source }
}

export function displaySourceForDecision(
  source: DecisionSource | undefined,
): GuardianDisplaySource {
  if (source === "llm-reviewer") return "LLM"
  if (source === "deterministic-policy" || source === "emergency-brake") return "deterministic"
  return "fail-safe"
}

export function withGuardianDetails<T>(value: T, guardian: GuardianDisplayDetails): T {
  const record = asRecord(value)
  if (!record) return value
  const details = asRecord(record.details) ?? {}
  return {
    ...record,
    details: {
      ...details,
      [DETAILS_KEY]: guardian,
    },
  } as T
}

export function guardianErrorPrefix(source: GuardianDisplaySource): string {
  return `[OMP Guardian · ${source}]`
}

export function renderGuardianBashCall(
  args: unknown,
  _options: RenderOptions,
  theme: ThemeLike,
): RenderComponent {
  return component(["Bash (OMP Guardian · checking)", `└─ command=${commandFrom(args)}`], theme)
}

export function renderGuardianBashResult(
  result: ToolResultLike,
  options: RenderOptions,
  theme: ThemeLike,
  args?: unknown,
): RenderComponent {
  const rendered = resultLines(result, options, args)
  return component(rendered.lines, theme, result.isError ? "error" : "toolTitle")
}

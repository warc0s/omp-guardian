import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { DEFAULT_CONFIG, resolveConfig } from "../config.ts"
import { parseJsonc } from "../config/jsonc.ts"
import type {
  OmpReviewerConfig,
  ReviewerModelSelection,
  ReviewerThinkingSelection,
  ThinkingLevel,
} from "./types.ts"

export const DEFAULT_OMP_AUDIT_PATH = join(homedir(), ".omp", "agent", "omp-guardian-audit.jsonl")

export const DEFAULT_OMP_CONFIG: OmpReviewerConfig = {
  ...DEFAULT_CONFIG,
  reviewerModel: "current",
  reviewerThinking: "current",
  timeoutMs: 24_000,
  maxContextChars: 16_000,
  maxEnrichmentChars: 12_000,
  transcriptMessages: 16,
  auditPath: DEFAULT_OMP_AUDIT_PATH,
  escalationMode: "manual",
  reviewTools: ["python", "notebook", "browser", "computer", "delete", "move"],
  protectedPaths: [
    ".env",
    ".env.*",
    "!.env.example",
    "**/.ssh/**",
    "**/.aws/**",
    "**/.config/gh/**",
    "**/.kube/config",
    "**/.netrc",
    "**/.npmrc",
    "**/.pypirc",
    "**/auth.json",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.kdbx",
    "**/id_rsa",
    "**/id_ed25519",
  ],
  reviewMcp: true,
  reviewUnknownTools: true,
  maxEvidenceChars: 28_000,
  autoAllowWorkspaceEdits: true,
  autoAllowReadOnlyBash: true,
  autoAllowLocalTests: true,
  reviewSubagentSpawns: false,
  trustedWriteRoots: [],
  deniedBashExecutables: ["sudo"],
}

function readObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return parseJsonc(readFileSync(path, "utf8"))
  } catch {
    return {}
  }
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return fallback
  return [...new Set(value)]
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "auto",
])

function reviewerModel(value: unknown): ReviewerModelSelection {
  if (value === "current") return value
  if (typeof value !== "string") return DEFAULT_OMP_CONFIG.reviewerModel
  const normalized = value.trim()
  const slash = normalized.indexOf("/")
  if (slash <= 0 || slash === normalized.length - 1) return DEFAULT_OMP_CONFIG.reviewerModel
  return normalized as ReviewerModelSelection
}

function reviewerThinking(value: unknown): ReviewerThinkingSelection {
  if (value === "current") return value
  return typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel)
    ? (value as ThinkingLevel)
    : DEFAULT_OMP_CONFIG.reviewerThinking
}

function resolveOmpConfig(source: Record<string, unknown>): OmpReviewerConfig {
  const shared = resolveConfig(source)
  return {
    ...DEFAULT_OMP_CONFIG,
    ...shared,
    reviewerModel: reviewerModel(source.reviewerModel),
    reviewerThinking: reviewerThinking(source.reviewerThinking),
    auditPath:
      typeof source.auditPath === "string" && source.auditPath.trim()
        ? source.auditPath.trim()
        : DEFAULT_OMP_AUDIT_PATH,
    reviewTools: stringArray(source.reviewTools, DEFAULT_OMP_CONFIG.reviewTools),
    protectedPaths: stringArray(source.protectedPaths, DEFAULT_OMP_CONFIG.protectedPaths),
    reviewMcp:
      typeof source.reviewMcp === "boolean" ? source.reviewMcp : DEFAULT_OMP_CONFIG.reviewMcp,
    reviewUnknownTools:
      typeof source.reviewUnknownTools === "boolean"
        ? source.reviewUnknownTools
        : DEFAULT_OMP_CONFIG.reviewUnknownTools,
    maxEvidenceChars: boundedInteger(
      source.maxEvidenceChars,
      DEFAULT_OMP_CONFIG.maxEvidenceChars,
      4_000,
      100_000,
    ),
    autoAllowWorkspaceEdits:
      typeof source.autoAllowWorkspaceEdits === "boolean"
        ? source.autoAllowWorkspaceEdits
        : DEFAULT_OMP_CONFIG.autoAllowWorkspaceEdits,
    autoAllowReadOnlyBash:
      typeof source.autoAllowReadOnlyBash === "boolean"
        ? source.autoAllowReadOnlyBash
        : DEFAULT_OMP_CONFIG.autoAllowReadOnlyBash,
    autoAllowLocalTests:
      typeof source.autoAllowLocalTests === "boolean"
        ? source.autoAllowLocalTests
        : DEFAULT_OMP_CONFIG.autoAllowLocalTests,
    reviewSubagentSpawns:
      typeof source.reviewSubagentSpawns === "boolean"
        ? source.reviewSubagentSpawns
        : DEFAULT_OMP_CONFIG.reviewSubagentSpawns,
    trustedWriteRoots: stringArray(source.trustedWriteRoots, DEFAULT_OMP_CONFIG.trustedWriteRoots),
    deniedBashExecutables: stringArray(
      source.deniedBashExecutables,
      DEFAULT_OMP_CONFIG.deniedBashExecutables,
    ),
  }
}

function clampProjectConfig(
  trusted: OmpReviewerConfig,
  project: Record<string, unknown>,
): Record<string, unknown> {
  const clamped: Record<string, unknown> = {}
  if (typeof project.confidenceThreshold === "number") {
    clamped.confidenceThreshold = Math.max(trusted.confidenceThreshold, project.confidenceThreshold)
  }
  if (Array.isArray(project.reviewTools)) {
    clamped.reviewTools = [
      ...new Set([...trusted.reviewTools, ...stringArray(project.reviewTools, [])]),
    ]
  }
  if (Array.isArray(project.protectedPaths)) {
    clamped.protectedPaths = [
      ...new Set([...trusted.protectedPaths, ...stringArray(project.protectedPaths, [])]),
    ]
  }
  if (project.escalationMode === "deny") clamped.escalationMode = "deny"
  if (project.autoAllowWorkspaceEdits === false) clamped.autoAllowWorkspaceEdits = false
  if (project.autoAllowReadOnlyBash === false) clamped.autoAllowReadOnlyBash = false
  if (project.autoAllowLocalTests === false) clamped.autoAllowLocalTests = false
  if (project.reviewSubagentSpawns === true) clamped.reviewSubagentSpawns = true
  if (Array.isArray(project.deniedBashExecutables)) {
    clamped.deniedBashExecutables = [
      ...new Set([
        ...trusted.deniedBashExecutables,
        ...stringArray(project.deniedBashExecutables, []),
      ]),
    ]
  }
  return clamped
}

export function globalConfigPath(): string {
  return join(homedir(), ".omp", "agent", "omp-guardian.jsonc")
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, ".omp", "guardian.jsonc")
}

export function loadOmpConfig(cwd: string, globalConfigPathOverride?: string): OmpReviewerConfig {
  const trusted = resolveOmpConfig(readObject(globalConfigPathOverride ?? globalConfigPath()))
  const project = readObject(projectConfigPath(cwd))
  return resolveOmpConfig({ ...trusted, ...clampProjectConfig(trusted, project) })
}

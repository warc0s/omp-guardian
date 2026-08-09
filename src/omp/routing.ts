import { basename } from "node:path"
import { analyzeCapability } from "../capability/bash-analyzer.ts"
import { parseCommand } from "../capability/command-parser.ts"
import { emergencyBrakeReason } from "../emergency-brake.ts"
import type { CapabilityAssessment, ParsedCommand } from "../types.ts"
import { isInsideRoot, isProtectedPath } from "./paths.ts"
import { requestFromToolCall } from "./request.ts"
import type { OmpExtensionContext, OmpReviewerConfig, OmpToolCallEvent } from "./types.ts"

export type RoutingDecision =
  | { route: "allow"; reason: string }
  | { route: "review"; reason: string }
  | { route: "deny"; reason: string }

const SAFE_TOOLS = new Set([
  "read",
  "grep",
  "glob",
  "find",
  "ls",
  "inspect_image",
  "ask",
  "todo",
  "hub",
  "yield",
])
const PATH_KEYS = ["path", "file_path", "target", "destination", "source", "rename"]
const READ_ONLY_COMMANDS = new Set([
  "pwd",
  "ls",
  "tree",
  "stat",
  "file",
  "du",
  "df",
  "cat",
  "head",
  "tail",
  "wc",
  "rg",
  "grep",
  "egrep",
  "fgrep",
  "sort",
  "uniq",
  "cut",
  "tr",
  "which",
  "whereis",
  "type",
  "realpath",
  "readlink",
  "basename",
  "dirname",
  "echo",
  "printf",
  "true",
  "false",
  "test",
  "date",
  "uname",
  "id",
  "whoami",
  "ps",
  "cd",
])
const READ_ONLY_GIT = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "rev-list",
  "ls-files",
  "ls-tree",
  "cat-file",
  "blame",
  "grep",
  "describe",
  "name-rev",
  "shortlog",
])
const READ_ONLY_LSP_ACTIONS = new Set([
  "diagnostics",
  "definition",
  "references",
  "hover",
  "symbols",
  "type_definition",
  "implementation",
  "status",
  "reload",
  "capabilities",
])

function pathsFromInput(input: Record<string, unknown>): string[] {
  return PATH_KEYS.flatMap((key) => (typeof input[key] === "string" ? [input[key]] : []))
}

function isReadOnlyComputerInput(input: Record<string, unknown>): boolean {
  if (input.read_only === true) return true
  if (!Array.isArray(input.actions) || input.actions.length === 0) return false
  if (Array.isArray(input.pendingSafetyChecks) && input.pendingSafetyChecks.length > 0) return false
  return input.actions.every(
    (action) =>
      action !== null &&
      typeof action === "object" &&
      "type" in action &&
      (action.type === "screenshot" || action.type === "wait"),
  )
}

function routeLsp(input: Record<string, unknown>): RoutingDecision {
  const action = typeof input.action === "string" ? input.action : ""
  if (READ_ONLY_LSP_ACTIONS.has(action)) {
    return { route: "allow", reason: "Read-only LSP query or local server control." }
  }
  if (action === "rename" && input.apply === false) {
    return { route: "allow", reason: "Read-only LSP rename preview." }
  }
  if (action === "code_actions" && input.apply !== true) {
    return { route: "allow", reason: "Read-only LSP code-action preview." }
  }
  return { route: "review", reason: "LSP action may edit files or execute a server command." }
}

function trueFact(value: { value: boolean | "unknown" }): boolean {
  return value.value === true
}

function hasRiskSignal(capability: CapabilityAssessment): boolean {
  return (
    trueFact(capability.writeEffects.externalWrite) ||
    trueFact(capability.writeEffects.deletion) ||
    trueFact(capability.network.observed) ||
    trueFact(capability.process.persistence) ||
    trueFact(capability.process.privilegeEscalation) ||
    trueFact(capability.remote.enabled) ||
    capability.actionClass.value === "git-mutation" ||
    trueFact(capability.invokesPackageLifecycleScripts) ||
    trueFact(capability.createsAdHocCode)
  )
}

function gitSubcommand(tokens: string[]): string | undefined {
  let index = 1
  while (index < tokens.length) {
    const token = tokens[index]!
    if (["-C", "-c", "--git-dir", "--work-tree"].includes(token)) {
      index += 2
      continue
    }
    if (token.startsWith("-")) {
      index += 1
      continue
    }
    return token
  }
  return
}

function isKnownReadOnly(parsed: ParsedCommand): boolean {
  if (parsed.effective.length === 0) return false
  return parsed.effective.every((command) => {
    const tokens = command.map((token) => token.value)
    const executable = basename(tokens[0] ?? "")
    if (executable === "git") return READ_ONLY_GIT.has(gitSubcommand(tokens) ?? "")
    if (executable === "find") {
      return !tokens.some((token) =>
        ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fls", "-fprint", "-fprintf"].includes(
          token,
        ),
      )
    }
    if (executable === "sed") {
      return !tokens.some((token) => token === "-i" || token.startsWith("-i"))
    }
    if (
      ["node", "python", "python3", "npm", "pnpm", "yarn", "bun", "corepack"].includes(executable)
    ) {
      return tokens.length === 2 && ["--version", "-v", "-V"].includes(tokens[1]!)
    }
    return READ_ONLY_COMMANDS.has(executable)
  })
}

function isRecognizedLocalTest(parsed: ParsedCommand): boolean {
  if (parsed.effective.length === 0) return false
  return parsed.effective.every((command) => {
    const tokens = command.map((token) => token.value)
    const executable = basename(tokens[0] ?? "")
    if (executable === "cd") return true
    if (["pytest", "py.test", "jest", "vitest", "mocha", "ava", "ctest"].includes(executable)) {
      return true
    }
    return ["bun", "cargo", "go"].includes(executable) && tokens[1] === "test"
  })
}

function hasDeniedExecutable(parsed: ParsedCommand, denied: readonly string[]): string | undefined {
  const blocked = new Set(denied.map((value) => basename(value)))
  const transparentWrappers = new Set(["env", "command", "nice", "nohup", "timeout", "stdbuf"])
  for (const segment of parsed.segments) {
    for (const token of segment.tokens) {
      const executable = basename(token.value)
      if (blocked.has(executable)) return executable
      if (transparentWrappers.has(executable) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token.value)) {
        continue
      }
      if (token.value.startsWith("-")) continue
      break
    }
  }
  return
}

async function bashTouchesProtectedPath(
  parsed: ParsedCommand,
  ctx: OmpExtensionContext,
  config: OmpReviewerConfig,
): Promise<boolean> {
  const targets = [
    ...parsed.redirections.flatMap((redirections) =>
      redirections
        .filter((redirection) =>
          [">", ">>", "1>", "2>", "2>>", "&>", "&>>"].includes(redirection.operator),
        )
        .map((redirection) => redirection.target),
    ),
    ...parsed.heredocs.flatMap((heredoc) =>
      heredoc.outputTarget === undefined ? [] : [heredoc.outputTarget],
    ),
  ]
  for (const target of targets) {
    if (await isProtectedPath(target, ctx.cwd, config.protectedPaths)) return true
  }
  return false
}

export async function routeBashCommand(
  event: OmpToolCallEvent,
  ctx: OmpExtensionContext,
  config: OmpReviewerConfig,
): Promise<RoutingDecision> {
  const request = requestFromToolCall(event, ctx)
  const emergency = emergencyBrakeReason(request)
  if (emergency) return { route: "deny", reason: emergency }
  const command = typeof event.input.command === "string" ? event.input.command : ""
  if (!command.trim()) return { route: "review", reason: "Shell command is missing or empty." }
  try {
    const parsed = parseCommand(command)
    const denied = hasDeniedExecutable(parsed, config.deniedBashExecutables)
    if (denied)
      return { route: "deny", reason: `Executable '${denied}' is denied by trusted policy.` }
    if (await bashTouchesProtectedPath(parsed, ctx, config)) {
      return { route: "review", reason: "Shell command writes to a protected path." }
    }
    const capability = analyzeCapability(parsed, ctx.cwd, ctx.cwd)
    if (capability.parserCompleteness !== "complete-for-supported-form") {
      return { route: "review", reason: "Shell command contains unresolved dynamic constructs." }
    }
    if (hasRiskSignal(capability)) {
      return { route: "review", reason: `Shell effects require review: ${capability.summary}.` }
    }
    if (config.autoAllowReadOnlyBash && isKnownReadOnly(parsed)) {
      return { route: "allow", reason: "Known read-only shell operation." }
    }
    if (
      config.autoAllowLocalTests &&
      trueFact(capability.invokesExistingTestRunner) &&
      isRecognizedLocalTest(parsed)
    ) {
      return {
        route: "allow",
        reason: "Recognized local test runner with no observed external effects.",
      }
    }
    if (
      config.autoAllowWorkspaceEdits &&
      (capability.actionClass.value === "workspace-write" ||
        capability.actionClass.value === "temporary-write")
    ) {
      return { route: "allow", reason: "Bounded workspace or temporary filesystem operation." }
    }
    return { route: "review", reason: `Shell capability is uncertain: ${capability.summary}.` }
  } catch {
    return { route: "review", reason: "Static shell analysis failed." }
  }
}

async function pathIsTrusted(path: string, ctx: OmpExtensionContext, config: OmpReviewerConfig) {
  const roots = [ctx.cwd, ...config.trustedWriteRoots]
  for (const root of roots) {
    if (await isInsideRoot(path, root, ctx.cwd)) return true
  }
  return false
}

export async function routeToolCall(
  event: OmpToolCallEvent,
  ctx: OmpExtensionContext,
  config: OmpReviewerConfig,
): Promise<RoutingDecision> {
  if (event.toolName === "bash") return await routeBashCommand(event, ctx, config)
  const paths = pathsFromInput(event.input)
  for (const path of paths) {
    if (await isProtectedPath(path, ctx.cwd, config.protectedPaths)) {
      return { route: "review", reason: "Tool targets a protected path." }
    }
  }
  if (SAFE_TOOLS.has(event.toolName))
    return { route: "allow", reason: "Read-only or local control tool." }
  if (event.toolName === "task" && !config.reviewSubagentSpawns) {
    return { route: "allow", reason: "Subagent actions remain independently gated." }
  }
  if (event.toolName === "web_search") {
    return { route: "review", reason: "Web search sends query content to an external service." }
  }
  if (event.toolName === "lsp") return routeLsp(event.input)
  if (event.toolName === "computer" && isReadOnlyComputerInput(event.input)) {
    return { route: "allow", reason: "OMP-enforced read-only desktop inspection." }
  }
  if (event.toolName === "write" || event.toolName === "edit") {
    if (!config.autoAllowWorkspaceEdits || paths.length === 0) {
      return { route: "review", reason: "File mutation requires review." }
    }
    for (const path of paths) {
      if (!(await pathIsTrusted(path, ctx, config))) {
        return { route: "review", reason: "File mutation targets outside trusted roots." }
      }
    }
    return { route: "allow", reason: "Ordinary file edit inside a trusted workspace." }
  }
  if (config.reviewTools.includes(event.toolName)) {
    return { route: "review", reason: "Tool is configured for review." }
  }
  if (
    config.reviewMcp &&
    (event.toolName.startsWith("mcp__") || event.toolName.startsWith("mcp_"))
  ) {
    return { route: "review", reason: "MCP tool effects are not declared to OMP Guardian." }
  }
  return config.reviewUnknownTools
    ? { route: "review", reason: "Unknown tool effects require review." }
    : { route: "allow", reason: "Unknown-tool review is disabled by trusted configuration." }
}

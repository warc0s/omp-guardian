import { afterEach, describe, expect, test } from "bun:test"
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_OMP_CONFIG, loadOmpConfig } from "../src/omp/config.ts"
import { OmpProcessReviewerInvoker } from "../src/omp/invoker.ts"
import { isProtectedPath } from "../src/omp/paths.ts"
import { routeBashCommand, routeToolCall } from "../src/omp/routing.ts"
import { installOmpApprovalReviewer, shouldReviewTool } from "../src/omp/runtime.ts"
import type {
  OmpExtensionApi,
  OmpExtensionContext,
  OmpReviewerConfig,
  OmpToolCallEvent,
  ReviewInvocation,
  ReviewerInvoker,
} from "../src/omp/types.ts"

const roots: string[] = []
afterEach(async () => {
  delete process.env.OMP_APPROVAL_REVIEWER_HOST
  delete process.env.OMP_APPROVAL_REVIEWER_CHILD
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function decision(outcome: "allow" | "deny" | "escalate" = "allow") {
  return {
    version: 2,
    outcome,
    risk_level: outcome === "deny" ? "high" : "low",
    user_authorization: "high",
    scope_alignment: "aligned",
    evidence_completeness: "sufficient",
    rationale:
      outcome === "allow" ? "The operation is explicitly authorized." : "The operation is unsafe.",
    confidence: 0.99,
  }
}

class MockInvoker implements ReviewerInvoker {
  calls: ReviewInvocation[] = []
  disposed = false
  constructor(public output: unknown = decision()) {}
  async invoke(request: ReviewInvocation): Promise<unknown> {
    this.calls.push(request)
    if (this.output instanceof Error) throw this.output
    return this.output
  }
  dispose(): void {
    this.disposed = true
  }
}

class MockPi {
  tool: Record<string, unknown> | undefined
  handlers = new Map<string, (...args: unknown[]) => unknown>()
  zod = {
    object: (shape: Record<string, unknown>) => ({ shape }),
    string: () => ({ describe: () => ({}) }),
    number: () => ({ optional: () => ({ describe: () => ({}) }) }),
  }
  registerTool(tool: Record<string, unknown>) {
    this.tool = tool
  }
  on(event: string, handler: (...args: unknown[]) => unknown) {
    this.handlers.set(event, handler)
  }
  getThinkingLevel() {
    return "max" as const
  }
}

async function fixture(output: unknown = decision(), overrides: Partial<OmpReviewerConfig> = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "omp-reviewer-test-"))
  roots.push(cwd)
  const invoker = new MockInvoker(output)
  const config: OmpReviewerConfig = {
    ...DEFAULT_OMP_CONFIG,
    ...overrides,
    auditPath: join(cwd, "audit.jsonl"),
  }
  const pi = new MockPi()
  installOmpApprovalReviewer(pi as unknown as OmpExtensionApi, {
    invoker,
    loadConfig: () => config,
  })
  let delegated = 0
  const ctx: OmpExtensionContext = {
    cwd,
    hasUI: false,
    ui: {},
    sessionManager: {
      getSessionId: () => "session-1",
      getBranch: () => [
        { type: "message", message: { role: "user", content: "Run the repository tests." } },
      ],
    },
    model: { provider: "commandcode", id: "deepseek/deepseek-v4-flash" },
    invokeTool: async () => {
      delegated++
      return { content: [{ type: "text", text: "native result" }], details: {} }
    },
  }
  return { cwd, invoker, config, pi, ctx, delegated: () => delegated }
}

describe("OMP tool routing", () => {
  test("reviews sensitive and unknown tools but bypasses ordinary reads and edits", async () => {
    const config = DEFAULT_OMP_CONFIG
    const event = (toolName: string, input: Record<string, unknown> = {}): OmpToolCallEvent => ({
      type: "tool_call",
      toolName,
      toolCallId: "call-1",
      input,
    })
    expect(
      await shouldReviewTool(event("read", { path: "README.md" }), process.cwd(), config),
    ).toBe(false)
    expect(await shouldReviewTool(event("edit", { path: "src/a.ts" }), process.cwd(), config)).toBe(
      false,
    )
    expect(await shouldReviewTool(event("edit", { path: ".env" }), process.cwd(), config)).toBe(
      true,
    )
    expect(await shouldReviewTool(event("task"), process.cwd(), config)).toBe(false)
    expect(await shouldReviewTool(event("hub"), process.cwd(), config)).toBe(false)
    expect(await shouldReviewTool(event("yield"), process.cwd(), config)).toBe(false)
    expect(
      await shouldReviewTool(
        event("computer", { code: "return await desktop.screenshot()", read_only: true }),
        process.cwd(),
        config,
      ),
    ).toBe(false)
    expect(
      await shouldReviewTool(
        event("computer", {
          actions: [{ type: "screenshot" }, { type: "wait" }],
          pendingSafetyChecks: [],
        }),
        process.cwd(),
        config,
      ),
    ).toBe(false)
    expect(
      await shouldReviewTool(
        event("computer", { code: "await desktop.click(10, 10)" }),
        process.cwd(),
        config,
      ),
    ).toBe(true)
    expect(
      await shouldReviewTool(
        event("computer", { actions: [{ type: "click", x: 10, y: 10 }] }),
        process.cwd(),
        config,
      ),
    ).toBe(true)
    expect(
      await shouldReviewTool(
        event("browser", { action: "run", code: "return 1" }),
        process.cwd(),
        config,
      ),
    ).toBe(true)
    expect(
      await shouldReviewTool(event("lsp", { action: "definition" }), process.cwd(), config),
    ).toBe(false)
    expect(
      await shouldReviewTool(
        event("lsp", { action: "rename", new_name: "changed" }),
        process.cwd(),
        config,
      ),
    ).toBe(true)
    expect(
      await shouldReviewTool(
        event("lsp", { action: "rename", new_name: "changed", apply: false }),
        process.cwd(),
        config,
      ),
    ).toBe(false)
    expect(
      await shouldReviewTool(
        event("lsp", { action: "code_actions", apply: true, query: "fix" }),
        process.cwd(),
        config,
      ),
    ).toBe(true)
    expect(
      await shouldReviewTool(event("web_search", { query: "private text" }), process.cwd(), config),
    ).toBe(true)
    expect(await shouldReviewTool(event("mcp__cloud__deploy"), process.cwd(), config)).toBe(true)
    expect(await shouldReviewTool(event("future_mutator"), process.cwd(), config)).toBe(true)
  })

  test("resolves symlinks before protected-path matching and honors exclusions", async () => {
    const root = await mkdtemp(join(tmpdir(), "omp-path-test-"))
    roots.push(root)
    await mkdir(join(root, "secrets"))
    await writeFile(join(root, "secrets", "auth.json"), "{}")
    await symlink(join(root, "secrets", "auth.json"), join(root, "visible.json"))
    expect(await isProtectedPath("visible.json", root, ["**/auth.json"])).toBe(true)
    expect(await isProtectedPath(".env.example", root, [".env.*", "!.env.example"])).toBe(false)
  })

  test("project configuration can tighten but cannot relax the trusted defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "omp-config-test-"))
    roots.push(root)
    await mkdir(join(root, ".omp"))
    await writeFile(
      join(root, ".omp", "approval-reviewer.jsonc"),
      JSON.stringify({
        confidenceThreshold: 0.91,
        audit: false,
        reviewTools: [],
        protectedPaths: [],
        escalationMode: "deny",
      }),
    )
    const config = loadOmpConfig(root, join(root, "missing-global.jsonc"))
    expect(config.confidenceThreshold).toBe(0.91)
    expect(config.audit).toBe(true)
    expect(config.reviewTools).toContain("python")
    expect(config.protectedPaths).toContain(".env")
    expect(config.escalationMode).toBe("deny")
  })

  test("loads reviewer overrides only from trusted global configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "omp-reviewer-model-config-"))
    roots.push(root)
    await mkdir(join(root, ".omp"))
    const globalConfig = join(root, "global.jsonc")
    await writeFile(
      globalConfig,
      JSON.stringify({
        reviewerModel: "openai-codex/gpt-5.6-luna",
        reviewerThinking: "max",
      }),
    )
    await writeFile(
      join(root, ".omp", "approval-reviewer.jsonc"),
      JSON.stringify({
        reviewerModel: "commandcode/deepseek/deepseek-v4-flash",
        reviewerThinking: "low",
      }),
    )

    const config = loadOmpConfig(root, globalConfig)
    expect(config.reviewerModel).toBe("openai-codex/gpt-5.6-luna")
    expect(config.reviewerThinking).toBe("max")
  })

  test("keeps current session inheritance when reviewer overrides are invalid", async () => {
    const root = await mkdtemp(join(tmpdir(), "omp-reviewer-invalid-config-"))
    roots.push(root)
    const globalConfig = join(root, "global.jsonc")
    await writeFile(
      globalConfig,
      JSON.stringify({ reviewerModel: "missing-provider", reviewerThinking: "extreme" }),
    )

    const config = loadOmpConfig(root, globalConfig)
    expect(config.reviewerModel).toBe("current")
    expect(config.reviewerThinking).toBe("current")
  })

  test("uses a cheap deterministic gate before spending a reviewer call", async () => {
    const harness = await fixture()
    const bashEvent = (command: string): OmpToolCallEvent => ({
      type: "tool_call",
      toolName: "bash",
      toolCallId: "route",
      input: { command },
    })
    expect(
      (await routeBashCommand(bashEvent("git status"), harness.ctx, harness.config)).route,
    ).toBe("allow")
    expect((await routeBashCommand(bashEvent("bun test"), harness.ctx, harness.config)).route).toBe(
      "allow",
    )
    expect(
      (await routeBashCommand(bashEvent("curl https://example.com"), harness.ctx, harness.config))
        .route,
    ).toBe("review")
    expect(
      (await routeBashCommand(bashEvent("git push origin main"), harness.ctx, harness.config))
        .route,
    ).toBe("review")
    expect(
      (await routeBashCommand(bashEvent("sudo apt update"), harness.ctx, harness.config)).route,
    ).toBe("deny")
    expect((await routeBashCommand(bashEvent("rm -rf /"), harness.ctx, harness.config)).route).toBe(
      "deny",
    )
    expect(
      (await routeBashCommand(bashEvent("echo sudo"), harness.ctx, harness.config)).route,
    ).toBe("allow")
    expect(
      (await routeBashCommand(bashEvent("printf value > .env"), harness.ctx, harness.config)).route,
    ).toBe("review")
  })

  test("routes a representative shell risk matrix conservatively", async () => {
    const harness = await fixture()
    const event = (command: string): OmpToolCallEvent => ({
      type: "tool_call",
      toolName: "bash",
      toolCallId: command,
      input: { command },
    })
    const matrix: Array<[string, "allow" | "review" | "deny"]> = [
      ["pwd", "allow"],
      ["rg TODO src", "allow"],
      ["git -C . diff --stat", "allow"],
      ["python3 --version", "allow"],
      ["pytest -q", "allow"],
      ["printf ok > result.txt", "allow"],
      ["curl https://example.com", "review"],
      ["wget https://example.com/archive", "review"],
      ["ssh host uptime", "review"],
      ["git commit -m test", "review"],
      ["git reset --hard HEAD", "review"],
      ["git clean -fd", "review"],
      ["rm result.txt", "review"],
      ["npm install", "review"],
      ["python3 script.py", "review"],
      ["node script.js", "review"],
      ["find . -delete", "review"],
      ["sed -i s/a/b/ file", "review"],
      ["printf ok > /etc/guardian-test", "review"],
      ["printf ok > .env", "review"],
      ["$RUNNER test", "review"],
      ["env sudo apt update", "deny"],
      ["command sudo apt update", "deny"],
    ]
    for (const [command, expected] of matrix) {
      expect((await routeBashCommand(event(command), harness.ctx, harness.config)).route).toBe(
        expected,
      )
    }
  })

  test("allows ordinary workspace edits but reviews protected and external paths", async () => {
    const harness = await fixture()
    const event = (path: string): OmpToolCallEvent => ({
      type: "tool_call",
      toolName: "edit",
      toolCallId: "edit-route",
      input: { path },
    })
    expect((await routeToolCall(event("src/app.ts"), harness.ctx, harness.config)).route).toBe(
      "allow",
    )
    expect((await routeToolCall(event(".env"), harness.ctx, harness.config)).route).toBe("review")
    expect((await routeToolCall(event("/etc/hosts"), harness.ctx, harness.config)).route).toBe(
      "review",
    )
    expect(
      (await routeToolCall({ ...event(".env"), toolName: "read" }, harness.ctx, harness.config))
        .route,
    ).toBe("review")
    expect(
      (
        await routeToolCall(
          { ...event("src/app.ts"), toolName: "task", input: { prompt: "inspect" } },
          harness.ctx,
          harness.config,
        )
      ).route,
    ).toBe("allow")
  })
})

describe("OMP runtime enforcement", () => {
  test("uses the active model at max with no fallback and delegates Bash exactly once after allow", async () => {
    const harness = await fixture()
    const execute = harness.pi.tool!.execute as (...args: unknown[]) => Promise<unknown>
    const result = await execute(
      "call-1",
      { command: "curl https://example.com/health" },
      undefined,
      undefined,
      harness.ctx,
    )
    expect(result).toMatchObject({
      details: {
        ompGuardian: {
          source: "LLM",
          model: "commandcode/deepseek/deepseek-v4-flash",
          thinking: "max",
        },
      },
    })
    expect(harness.delegated()).toBe(1)
    expect(harness.invoker.calls).toHaveLength(1)
    expect(harness.invoker.calls[0]).toMatchObject({
      model: { provider: "commandcode", id: "deepseek/deepseek-v4-flash" },
      thinkingLevel: "max",
      cwd: harness.cwd,
    })
    expect(harness.invoker.calls[0]!.prompt).toContain("Run the repository tests")
    expect(harness.invoker.calls[0]!.prompt).toContain("curl https://example.com/health")
  })

  test("uses a dedicated reviewer model and thinking level without changing the active agent", async () => {
    const harness = await fixture(decision(), {
      reviewerModel: "openai-codex/gpt-5.6-luna",
      reviewerThinking: "max",
    })
    const execute = harness.pi.tool!.execute as (...args: unknown[]) => Promise<unknown>
    await execute(
      "dedicated-reviewer",
      { command: "curl https://example.com/health" },
      undefined,
      undefined,
      harness.ctx,
    )
    expect(harness.ctx.model).toEqual({
      provider: "commandcode",
      id: "deepseek/deepseek-v4-flash",
    })
    expect(harness.invoker.calls).toHaveLength(1)
    expect(harness.invoker.calls[0]).toMatchObject({
      model: { provider: "openai-codex", id: "gpt-5.6-luna" },
      thinkingLevel: "max",
    })
    const record = JSON.parse(await readFile(join(harness.cwd, "audit.jsonl"), "utf8"))
    expect(record.reviewerModel).toBe("openai-codex/gpt-5.6-luna")
  })

  test("deterministic emergency brake blocks before any model call", async () => {
    const harness = await fixture()
    const execute = harness.pi.tool!.execute as (...args: unknown[]) => Promise<unknown>
    await expect(
      execute("call-2", { command: "rm -rf /" }, undefined, undefined, harness.ctx),
    ).rejects.toThrow("Emergency brake")
    expect(harness.invoker.calls).toHaveLength(0)
    expect(harness.delegated()).toBe(0)
    const record = JSON.parse(await readFile(join(harness.cwd, "audit.jsonl"), "utf8"))
    expect(record).toMatchObject({ outcome: "deny", decisionSource: "emergency-brake" })
    expect(record).not.toHaveProperty("riskLevel")
  })

  test("marks deterministic Bash allows without invoking the reviewer", async () => {
    const harness = await fixture()
    const execute = harness.pi.tool!.execute as (...args: unknown[]) => Promise<unknown>
    const result = await execute("read-only", { command: "pwd" }, undefined, undefined, harness.ctx)
    expect(result).toMatchObject({ details: { ompGuardian: { source: "deterministic" } } })
    expect(harness.invoker.calls).toHaveLength(0)
  })

  test("preserves the Guardian source when native Bash fails after approval", async () => {
    const harness = await fixture()
    harness.ctx.invokeTool = async () => {
      throw new Error("Command exited with code 2")
    }
    const execute = harness.pi.tool!.execute as (...args: unknown[]) => Promise<unknown>
    await expect(
      execute("native-failure", { command: "pwd" }, undefined, undefined, harness.ctx),
    ).rejects.toThrow("[OMP Guardian · deterministic] Command exited with code 2")
    expect(harness.invoker.calls).toHaveLength(0)
  })

  test("trusted hard-deny policy blocks without inference and records the decision", async () => {
    const harness = await fixture()
    const execute = harness.pi.tool!.execute as (...args: unknown[]) => Promise<unknown>
    await expect(
      execute("sudo", { command: "sudo apt update" }, undefined, undefined, harness.ctx),
    ).rejects.toThrow("denied by trusted policy")
    expect(harness.invoker.calls).toHaveLength(0)
    const record = JSON.parse(await readFile(join(harness.cwd, "audit.jsonl"), "utf8"))
    expect(record).toMatchObject({ outcome: "deny", decisionSource: "deterministic-policy" })
  })

  test("deny, invalid JSON, reviewer failure, and headless escalation all block", async () => {
    for (const output of [
      decision("deny"),
      { malformed: true },
      new Error("provider unavailable"),
      decision("escalate"),
    ]) {
      const harness = await fixture(output)
      const execute = harness.pi.tool!.execute as (...args: unknown[]) => Promise<unknown>
      await expect(
        execute(
          "call-x",
          { command: "curl https://example.com/health" },
          undefined,
          undefined,
          harness.ctx,
        ),
      ).rejects.toThrow()
      expect(harness.delegated()).toBe(0)
    }
  })

  test("generic tool hook blocks a denied MCP call and lets safe read pass without inference", async () => {
    const harness = await fixture(decision("deny"))
    const handler = harness.pi.handlers.get("tool_call")!
    const safe = await handler(
      { type: "tool_call", toolName: "read", toolCallId: "safe", input: { path: "README.md" } },
      harness.ctx,
    )
    expect(safe).toBeUndefined()
    expect(harness.invoker.calls).toHaveLength(0)
    const blocked = await handler(
      { type: "tool_call", toolName: "mcp__host__deploy", toolCallId: "mcp", input: {} },
      harness.ctx,
    )
    expect(blocked).toMatchObject({ block: true })
    expect(harness.invoker.calls).toHaveLength(1)
  })

  test("aborts a turn after three consecutive denials and resets the streak after an allow", async () => {
    const harness = await fixture(decision("deny"))
    let aborts = 0
    const notices: string[] = []
    harness.ctx.abort = () => aborts++
    harness.ctx.ui.notify = (message) => notices.push(message)
    const handler = harness.pi.handlers.get("tool_call")!
    const denied = (id: string) =>
      handler(
        { type: "tool_call", toolName: "mcp__host__deploy", toolCallId: id, input: {} },
        harness.ctx,
      )
    await denied("deny-1")
    await denied("deny-2")
    await handler(
      { type: "tool_call", toolName: "read", toolCallId: "reset", input: { path: "README.md" } },
      harness.ctx,
    )
    await denied("deny-3")
    await denied("deny-4")
    expect(aborts).toBe(0)
    const result = await denied("deny-5")
    expect(result).toMatchObject({ block: true })
    expect((result as { reason: string }).reason).toContain("circuit breaker")
    expect(aborts).toBe(1)
    expect(notices).toHaveLength(1)
  })

  test("audit contains only a hash, redacts secrets, and is mode 0600", async () => {
    const harness = await fixture(decision("deny"))
    const execute = harness.pi.tool!.execute as (...args: unknown[]) => Promise<unknown>
    await expect(
      execute(
        "audit",
        { command: "curl -H 'Authorization: Bearer super-secret-token' x" },
        undefined,
        undefined,
        harness.ctx,
      ),
    ).rejects.toThrow()
    const audit = await readFile(join(harness.cwd, "audit.jsonl"), "utf8")
    expect(audit).not.toContain("super-secret-token")
    expect(audit).not.toContain("curl -H")
    expect(harness.invoker.calls[0]!.prompt).not.toContain("super-secret-token")
    expect(JSON.parse(audit).actionHash).toMatch(/^[a-f0-9]{64}$/)
    expect((await lstat(join(harness.cwd, "audit.jsonl"))).mode & 0o777).toBe(0o600)
  })

  test("interactive escalation requires an explicit allow-once choice", async () => {
    const harness = await fixture(decision("escalate"))
    harness.ctx.hasUI = true
    harness.ctx.ui.select = async () => "Allow once"
    const execute = harness.pi.tool!.execute as (...args: unknown[]) => Promise<unknown>
    const result = await execute(
      "manual",
      { command: "curl https://example.com/health" },
      undefined,
      undefined,
      harness.ctx,
    )
    expect(harness.delegated()).toBe(1)
    expect(result).toMatchObject({ details: { ompGuardian: { source: "manual" } } })
  })

  test("handles concurrent reviews without dropping audit records", async () => {
    const harness = await fixture()
    const handler = harness.pi.handlers.get("tool_call")!
    const count = 32
    const outcomes = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        handler(
          {
            type: "tool_call",
            toolName: "mcp__host__mutate",
            toolCallId: `concurrent-${index}`,
            input: { prompt: `Inspect shard ${index}` },
          },
          harness.ctx,
        ),
      ),
    )
    expect(outcomes.every((outcome) => outcome === undefined)).toBe(true)
    expect(harness.invoker.calls).toHaveLength(count)
    const records = (await readFile(join(harness.cwd, "audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(records).toHaveLength(count)
    expect(new Set(records.map((record) => record.requestID)).size).toBe(count)
  })

  test("shutdown disposes reviewer children and child mode registers nothing", async () => {
    const harness = await fixture()
    await harness.pi.handlers.get("session_shutdown")!()
    expect(harness.invoker.disposed).toBe(true)
    process.env.OMP_APPROVAL_REVIEWER_CHILD = "1"
    const childPi = new MockPi()
    installOmpApprovalReviewer(childPi as unknown as OmpExtensionApi)
    expect(childPi.tool).toBeUndefined()
    expect(childPi.handlers.size).toBe(0)
  })
})

describe("reviewer subprocess isolation", () => {
  test("passes the exact active model and disables tools, sessions, rules, skills, and LSP", async () => {
    const fake = join(import.meta.dir, "fixtures", "fake-omp.ts")
    await chmod(fake, 0o755)
    process.env.OMP_APPROVAL_REVIEWER_HOST = fake
    const cwd = await mkdtemp(join(tmpdir(), "omp-process-test-"))
    roots.push(cwd)
    const invoker = new OmpProcessReviewerInvoker()
    const result = await invoker.invoke({
      model: { provider: "commandcode", id: "deepseek/deepseek-v4-flash" },
      thinkingLevel: "max",
      prompt: "review",
      timeoutMs: 5_000,
      cwd,
    })
    expect(result).toMatchObject({ outcome: "allow", version: 2 })
    invoker.dispose()
  })

  test("parses fenced reviewer JSON without a backtracking expression", async () => {
    const fake = join(import.meta.dir, "fixtures", "fake-omp.ts")
    await chmod(fake, 0o755)
    process.env.OMP_APPROVAL_REVIEWER_HOST = fake
    process.env.OMP_TEST_FENCED_OUTPUT = "1"
    const cwd = await mkdtemp(join(tmpdir(), "omp-fenced-output-test-"))
    roots.push(cwd)
    const invoker = new OmpProcessReviewerInvoker()
    try {
      const result = await invoker.invoke({
        model: { provider: "commandcode", id: "deepseek/deepseek-v4-flash" },
        thinkingLevel: "max",
        prompt: "review",
        timeoutMs: 5_000,
        cwd,
      })
      expect(result).toMatchObject({ outcome: "allow", version: 2 })
    } finally {
      delete process.env.OMP_TEST_FENCED_OUTPUT
      invoker.dispose()
    }
  })
})

import { describe, expect, test } from "bun:test"
import {
  renderGuardianBashResult,
  withGuardianDetails,
  type GuardianDisplaySource,
} from "../src/omp/bash-renderer.ts"

const theme = {
  bold: (text: string) => text,
  fg: (_token: string, text: string) => text,
}

function renderedTitle(source: GuardianDisplaySource): string {
  const result = withGuardianDetails(
    { content: [{ type: "text", text: "ok" }], details: {} },
    source === "LLM" ? { source, model: "openai-codex/gpt-5.6-luna", thinking: "max" } : { source },
  )
  return renderGuardianBashResult(result, {}, theme, { command: "pwd" }).render(120)[0] ?? ""
}

describe("OMP Guardian Bash renderer", () => {
  test("renders each terminal decision source in the card title", () => {
    expect(renderedTitle("deterministic")).toBe("Bash (OMP Guardian · deterministic)")
    expect(renderedTitle("LLM")).toBe("Bash (OMP Guardian · LLM)")
    expect(renderedTitle("manual")).toBe("Bash (OMP Guardian · manual)")
    expect(renderedTitle("fail-safe")).toBe("Bash (OMP Guardian · fail-safe)")
  })

  test("shows reviewer identity only for LLM decisions", () => {
    const result = withGuardianDetails(
      {
        content: [{ type: "text", text: "ok\n\nWall time: 0.13 seconds" }],
        details: { exitCode: 0, wallTimeMs: 125, timeoutSeconds: 30 },
      },
      { source: "LLM", model: "openai-codex/gpt-5.6-luna", thinking: "max" },
    )
    const lines = renderGuardianBashResult(result, {}, theme, { command: "pwd" }).render(120)
    expect(lines).toContain("   reviewer=openai-codex/gpt-5.6-luna · reasoning=max")
    expect(lines).toContain("⟦Wall: 0.13s | Timeout: 30s⟧")
    expect(lines).not.toContain("Wall time: 0.13 seconds")
    expect(result.details).toMatchObject({ exitCode: 0 })
  })

  test("recovers the source from blocked tool errors without result metadata", () => {
    const result = {
      content: [{ type: "text", text: "Error: [OMP Guardian · manual] User rejected." }],
      isError: true,
    }
    expect(renderGuardianBashResult(result, {}, theme, { command: "curl x" }).render(120)[0]).toBe(
      "Bash (OMP Guardian · manual)",
    )
  })
})

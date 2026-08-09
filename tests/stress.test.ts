import { describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { parseDecision } from "../src/decision.ts"
import { emergencyBrakeReason } from "../src/emergency-brake.ts"
import { enrichGitEvidence } from "../src/git-evidence.ts"
import { enrichLocalScriptEvidence } from "../src/local-script-evidence.ts"
import { enrichSshEvidence } from "../src/ssh-evidence.ts"
import { decision, request } from "./helpers.ts"

const execFileAsync = promisify(execFile)

describe("stress and adversarial robustness", () => {
  test("rejects 5,000 mutated invalid structured outputs", () => {
    for (let item = 0; item < 5_000; item += 1) {
      const base = decision("allow") as unknown as Record<string, unknown>
      const field = item % 5
      if (field === 0) base.outcome = `allow_${item}`
      if (field === 1) base.risk_level = item
      if (field === 2) base.user_authorization = null
      if (field === 3) base.rationale = item % 2 ? "" : "x".repeat(2_001)
      if (field === 4) base.confidence = item % 2 ? -0.01 : 1.01
      expect(parseDecision(base)).toBeUndefined()
    }
  })

  test("does not confuse bounded deletion with root destruction across 1,000 paths", () => {
    for (let item = 0; item < 1_000; item += 1) {
      expect(
        emergencyBrakeReason(request({ metadata: { command: `rm -rf /tmp/build-${item}` } })),
      ).toBeUndefined()
    }
  })

  test("structures 2,000 concurrent SSH requests without crossing destinations", async () => {
    const results = await Promise.all(
      Array.from({ length: 2_000 }, (_, item) => {
        const command =
          item % 2 === 0
            ? `ssh -p 22 user@192.0.2.${item % 250} 'docker ps --filter name=app-${item}'`
            : `ssh -p 2222 user@198.51.100.${item % 250} 'docker restart app-${item}'`
        return enrichSshEvidence(
          request({ id: `per_ssh_${item}`, patterns: [command], metadata: { command } }),
          tmpdir(),
          tmpdir(),
          4_000,
        )
      }),
    )
    expect(results).toHaveLength(2_000)
    for (let item = 0; item < results.length; item += 1) {
      const result = results[item]!
      expect(result.audit).toHaveLength(1)
      expect(result.audit[0]?.destination).toContain(item % 2 === 0 ? "192.0.2." : "198.51.100.")
      expect(result.text).toContain(`app-${item}`)
      expect(result.text).toContain(`"mutationHint": ${item % 2 === 0 ? "false" : "true"}`)
    }
  }, 30_000)

  test("inspects 500 concurrent local scripts without crossing their contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "omp-reviewer-script-stress-"))
    try {
      await Promise.all(
        Array.from({ length: 500 }, (_, item) =>
          writeFile(join(directory, `script-${item}.py`), `print("SCRIPT_MARKER_${item}")\n`),
        ),
      )
      const results = await Promise.all(
        Array.from({ length: 500 }, (_, item) => {
          const command = `python3 ${join(directory, `script-${item}.py`)}`
          return enrichLocalScriptEvidence(
            request({ id: `per_script_${item}`, patterns: [command], metadata: { command } }),
            directory,
            directory,
            4_000,
          )
        }),
      )
      for (let item = 0; item < results.length; item += 1) {
        expect(results[item]?.text).toContain(`SCRIPT_MARKER_${item}`)
        expect(results[item]?.text).not.toContain(`SCRIPT_MARKER_${(item + 1) % 500}`)
      }
    } finally {
      await rm(directory, { recursive: true })
    }
  }, 30_000)

  test("takes 100 concurrent read-only Git snapshots without crossing discard targets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "omp-reviewer-git-stress-"))
    try {
      await execFileAsync("git", ["init", "-b", "stress"], { cwd: directory })
      await execFileAsync("git", ["config", "user.email", "reviewer@example.invalid"], {
        cwd: directory,
      })
      await execFileAsync("git", ["config", "user.name", "Reviewer Stress"], { cwd: directory })
      await Promise.all(
        Array.from({ length: 100 }, (_, item) =>
          writeFile(join(directory, `target-${item}.txt`), `before-${item}\n`),
        ),
      )
      await execFileAsync("git", ["add", "."], { cwd: directory })
      await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: directory })
      await Promise.all(
        Array.from({ length: 100 }, (_, item) =>
          writeFile(join(directory, `target-${item}.txt`), `after-${item}\n`),
        ),
      )

      const results = await Promise.all(
        Array.from({ length: 100 }, (_, item) => {
          const command = `git checkout HEAD -- target-${item}.txt`
          return enrichGitEvidence(
            request({ id: `per_git_${item}`, patterns: [command], metadata: { command } }),
            directory,
            8_000,
          )
        }),
      )
      for (let item = 0; item < results.length; item += 1) {
        const record = JSON.parse(results[item]!.text.replace(/^GIT_STATE_ANALYSIS\n/, "")) as {
          branch: string
          discardTargets: { values: string[] }
          affectedTargetNumstat: string
        }
        expect(record.branch).toBe("stress")
        expect(record.discardTargets.values).toEqual([`target-${item}.txt`])
        const numstat = record.affectedTargetNumstat
        if (!numstat.startsWith("<")) {
          expect(numstat).toContain(`target-${item}.txt`)
          for (let other = 0; other < 100; other += 1) {
            if (other !== item) expect(numstat).not.toContain(`target-${other}.txt`)
          }
        }
      }
    } finally {
      await rm(directory, { recursive: true })
    }
  }, 30_000)
})

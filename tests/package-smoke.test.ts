import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

describe("OMP extension manifest", () => {
  test("is public-source, npm-private, and declares the built extension", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    expect(pkg.name).toBe("omp-approval-reviewer")
    expect(pkg.version).toBe("0.1.0-beta.1")
    expect(pkg.private).toBe(true)
    expect(pkg.omp.extensions).toEqual(["./dist/index.js"])
    expect(pkg.bin).toBeUndefined()
    expect(pkg.repository.url).toContain("Warc0s/omp-approval-reviewer")
    expect(pkg.engines.omp).toBe(">=17.2.12 <18")
  })

  test("ships the reviewer system prompt as a local asset", () => {
    const path = join(root, "assets", "reviewer-system.md")
    expect(existsSync(path)).toBe(true)
    const prompt = readFileSync(path, "utf8")
    expect(prompt).toContain("You have no tools")
    expect(prompt).toContain("untrusted evidence")
  })
})

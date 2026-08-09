#!/usr/bin/env bun
const args = process.argv.slice(2)
const required = [
  "--no-tools",
  "--no-session",
  "--no-lsp",
  "--no-skills",
  "--no-rules",
  "--no-title",
  "--no-prewalk",
  "--no-pty",
]
if (!required.every((flag) => args.includes(flag))) process.exit(41)
if (process.env.OMP_APPROVAL_REVIEWER_CHILD !== "1") process.exit(42)
if (args[args.indexOf("--model") + 1] !== "commandcode/deepseek/deepseek-v4-flash") process.exit(43)
if (args[args.indexOf("--thinking") + 1] !== "max") process.exit(44)
console.log(
  JSON.stringify({
    version: 2,
    outcome: "allow",
    risk_level: "low",
    user_authorization: "high",
    scope_alignment: "aligned",
    evidence_completeness: "sufficient",
    rationale: "The requested validation is explicitly authorized.",
    confidence: 0.99,
  }),
)

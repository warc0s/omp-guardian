import { realpath } from "node:fs/promises"
import { basename, dirname, resolve, sep } from "node:path"

function normalize(path: string): string {
  return path.split(sep).join("/")
}

function globRegex(pattern: string): RegExp {
  const escaped = normalize(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__OMP_DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replaceAll("__OMP_DOUBLE_STAR__", ".*")
  return new RegExp(`(?:^|/)${escaped}$`, "i")
}

export async function canonicalPath(path: string, cwd: string): Promise<string> {
  const absolute = resolve(cwd, path)
  try {
    return normalize(await realpath(absolute))
  } catch {
    try {
      const parent = await realpath(dirname(absolute))
      return normalize(resolve(parent, basename(absolute)))
    } catch {
      return normalize(absolute)
    }
  }
}

export async function isInsideRoot(path: string, root: string, cwd: string): Promise<boolean> {
  const [target, boundary] = await Promise.all([canonicalPath(path, cwd), canonicalPath(root, cwd)])
  return target === boundary || target.startsWith(`${boundary}/`)
}

export async function isProtectedPath(
  path: string,
  cwd: string,
  patterns: readonly string[],
): Promise<boolean> {
  const target = await canonicalPath(path, cwd)
  let protectedMatch = false
  for (const raw of patterns) {
    const negated = raw.startsWith("!")
    const pattern = negated ? raw.slice(1) : raw
    if (!pattern || !globRegex(pattern).test(target)) continue
    protectedMatch = !negated
  }
  return protectedMatch
}

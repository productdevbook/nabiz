import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

export function read(rel: string): string {
  const p = join(ROOT, rel)
  return existsSync(p) ? readFileSync(p, "utf8") : ""
}

export function has(rel: string): boolean {
  return existsSync(join(ROOT, rel))
}

export function walk(rel: string, ext = ""): string[] {
  const dir = join(ROOT, rel)
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const child = `${rel}/${e.name}`
    if (e.isDirectory()) out.push(...walk(child, ext))
    else if (e.name.endsWith(ext)) out.push(child)
  }
  return out.toSorted()
}

/** From `new Response(` (or any call) to its matching close paren. */
export function callAt(text: string, open: number): string {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]
    if (c === "(") depth += 1
    else if (c === ")") {
      depth -= 1
      if (depth === 0) return text.slice(open, i + 1)
    }
  }
  return text.slice(open)
}

export function callsTo(text: string, name: string): string[] {
  const out: string[] = []
  const re = new RegExp(`\\b${name}\\s*\\(`, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(callAt(text, m.index + m[0].length - 1))
  return out
}

// Hook plumbing: read the event JSON, fail OPEN on internal errors, exit 2 (stderr → Claude) on a violation.
import { readFileSync } from 'node:fs'

export function readInput() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}') } catch { return {} }
}
export const projectDir = (input) => process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
export function block(reason) { process.stderr.write(`[engineering-standard] BLOCKED — ${reason}\n`); process.exit(2) }
export function emit(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0) }
// Run a hook body; any thrown error (bug, bad input, missing file) lets the tool call proceed.
export async function hook(fn) {
  try { await fn(readInput()) } catch (e) {
    if (process.env.STANDARD_HOOK_DEBUG) process.stderr.write(`[engineering-standard] hook error (fail-open): ${e.stack}\n`)
    process.exit(0)
  }
  process.exit(0)
}

// Run the kit's semgrep rules on files (PostToolUse hook + MCP check). Zero deps.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, accessSync, constants } from 'node:fs'
import { delimiter, join, relative, isAbsolute } from 'node:path'
import { ROOT } from './rules.mjs'

export function which(bin) {
  for (const d of (process.env.PATH || '').split(delimiter)) {
    const p = join(d, bin)
    try { accessSync(p, constants.X_OK); return p } catch {}
  }
  return null
}
export const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|css|scss|html|dart|go|py|swift)$/
// Repo-vendored rules (adopt.sh → .semgrep/standard, version-matched to the repo) win over the plugin's copy.
export function semgrepConfigs(cwd) {
  const vendored = join(cwd, '.semgrep/standard')
  if (existsSync(vendored)) return [vendored]
  return readdirSync(join(ROOT, 'semgrep')).filter((f) => f.endsWith('.yml') && !f.endsWith('.test.yml')).map((f) => join(ROOT, 'semgrep', f))
}
const srcLine = (cwd, p, l) => { try { return readFileSync(join(cwd, p), 'utf8').split('\n')[l - 1].trim() } catch { return '' } }

// → { available, findings: [{ rule, path, line, message, standard }], baselined, error? }
export function runSemgrep(files, { cwd = process.cwd(), timeoutMs = 60000 } = {}) {
  const bin = which('semgrep')
  if (!bin) return { available: false, findings: [], error: 'semgrep not installed (pipx install semgrep) — kit lint skipped; CI still runs it' }
  const rel = files.map((f) => (isAbsolute(f) ? relative(cwd, f) : f)).filter((f) => existsSync(join(cwd, f)))
  if (!rel.length) return { available: true, findings: [] }
  const args = ['--metrics=off', '--disable-version-check', '-q', '--json', ...semgrepConfigs(cwd).flatMap((c) => ['--config', c]), ...rel]
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 << 20 })
  if (r.error) return { available: true, findings: [], error: `semgrep failed: ${r.error.message}` }
  let j; try { j = JSON.parse(r.stdout) } catch { return { available: true, findings: [], error: `semgrep output unreadable: ${(r.stderr || '').slice(0, 300)}` } }
  let findings = (j.results || []).map((x) => ({ rule: x.check_id.replace(/^.*?(std\.)/, '$1'), path: x.path, line: x.start.line,
    message: x.extra?.message || '', standard: x.extra?.metadata?.standard || [] }))
  let baselined = 0
  const bp = join(cwd, '.semgrep/baseline.json')
  if (existsSync(bp)) {
    try {
      const budget = new Map()
      for (const k of JSON.parse(readFileSync(bp, 'utf8')).keys || []) { const key = k.map(String).join('\u0000').replace(/^.*?(std\.)/, '$1'); budget.set(key, (budget.get(key) || 0) + 1) }
      findings = findings.filter((f) => {
        const key = [f.rule, f.path, srcLine(cwd, f.path, f.line)].join('\u0000'), n = budget.get(key) || 0
        if (n > 0) { budget.set(key, n - 1); baselined++; return false }
        return true
      })
    } catch {}
  }
  return { available: true, findings, baselined, errors: (j.errors || []).map((e) => e.message).slice(0, 3) }
}

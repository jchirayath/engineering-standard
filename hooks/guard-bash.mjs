#!/usr/bin/env node
// PreToolUse Bash — AGT-1 secret reads, AGT-3 bypass flag, ENF-2 --no-verify, REPO-2 force-push to main,
// SEC-31 curl|sh, and SEC-31/NPM-1/SUP-1 dependency verification for installs of NAMED packages:
// block when the package doesn't exist or the version is < 7 days old. Network failure → allow + warn.
// Cooldown override (security fixes only, VULN-5): STANDARD_ALLOW_YOUNG_DEP=<name>[,<name>…] in the
// environment or as a prefix of the install command.
import { spawnSync } from 'node:child_process'
import { hook, block, emit, projectDir } from '../lib/hookio.mjs'
import { bashViolation } from '../lib/guards.mjs'
import { installedPackages, verifyDependency } from '../lib/deps.mjs'

hook(async (input) => {
  const cmd = String(input.tool_input?.command || '')
  if (!cmd.trim()) return
  let branch
  if (/\bgit\b[\s\S]*\bpush\b/.test(cmd)) {
    const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectDir(input), encoding: 'utf8', timeout: 1000 })
    branch = (r.stdout || '').trim()
  }
  const v = bashViolation(cmd, { branch })
  if (v) block(v.reason)

  const pkgs = installedPackages(cmd).slice(0, 6)
  if (!pkgs.length || process.env.STANDARD_DEP_CHECK === 'off') return
  const allow = new Set([process.env.STANDARD_ALLOW_YOUNG_DEP, (cmd.match(/\bSTANDARD_ALLOW_YOUNG_DEP=(\S+)/) || [])[1]]
    .filter(Boolean).flatMap((s) => s.split(',')).map((s) => s.trim()))
  const results = await Promise.all(pkgs.map((p) => verifyDependency({ ...p, security_fix: allow.has(p.name), osv: false, timeoutMs: 3000 })))
  const blocks = results.filter((r) => r.verdict === 'block')
  if (blocks.length) block(blocks.flatMap((r) => r.reasons).join(' | ') + ' — verify with the MCP tool verify_dependency; a security fix inside the cooldown may set STANDARD_ALLOW_YOUNG_DEP=<name> (VULN-5).')
  const notes = results.flatMap((r) => [...r.warnings, ...r.errors.map((e) => `${r.name}: ${e} — dependency NOT verified (fail-open; CI still checks)`)])
  if (notes.length) {
    const text = `[engineering-standard] ${notes.join(' | ')}`
    emit({ systemMessage: text, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } })
  }
})

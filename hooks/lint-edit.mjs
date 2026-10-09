#!/usr/bin/env node
// PostToolUse Edit|Write|MultiEdit — run the kit's semgrep rules (repo .semgrep/standard if vendored, else the
// plugin's) on the touched file; exit 2 feeds violations back so they're fixed in the same turn. Respects
// .semgrep/baseline.json. No semgrep installed → silent no-op (CI still runs it).
import { hook, block, projectDir } from '../lib/hookio.mjs'
import { runSemgrep, CODE_EXT } from '../lib/semgrep.mjs'

hook((input) => {
  const f = input.tool_input?.file_path || ''
  if (!CODE_EXT.test(f) || /(^|\/)(node_modules|\.dart_tool|build|dist|\.next|Pods)\//.test(f)) return
  const r = runSemgrep([f], { cwd: projectDir(input), timeoutMs: 25000 })
  if (!r.findings?.length) return
  block(`kit lint found ${r.findings.length} violation(s) in ${f}:\n` + r.findings.map((x) =>
    `  ${x.path}:${x.line}  ${x.rule}  ${x.message}`).join('\n') +
    '\nFix them now. A justified single line may carry `nosemgrep: <rule-id> -- <reason>` (ENF-2).')
})

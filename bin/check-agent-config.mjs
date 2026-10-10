#!/usr/bin/env node
// §2C agent-config lint (run by tools/standard/check.sh in CI). Zero deps; reads the repo it runs in.
//   AGT-1  .claude/settings.json denies reading .env / secrets and disables bypass-permissions mode
//   AGT-7  every project subagent (.claude/agents/*.md) declares a tools: allow-list
//   AGT-5  .mcp.json stdio servers are pinned (no bare `npx -y <pkg>` / @latest)
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const root = process.argv[2] || '.', errors = []
const settings = (() => { try { return JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8')) } catch (e) { return e.code === 'ENOENT' ? null : 'invalid' } })()
if (settings === null) errors.push('AGT-1: .claude/settings.json is missing — run engineering-standard/bin/adopt.sh')
else if (settings === 'invalid') errors.push('AGT-1: .claude/settings.json is not valid JSON')
else {
  const deny = settings.permissions?.deny || []
  if (!deny.some((d) => /^Read\(\.?\/?\.env\)$/.test(d))) errors.push('AGT-1: permissions.deny lacks Read(./.env)')
  if (!deny.some((d) => /^Read\(.*secrets/.test(d))) errors.push('AGT-1: permissions.deny lacks Read(./secrets/**)')
  if (settings.permissions?.disableBypassPermissionsMode !== 'disable') errors.push('AGT-1: permissions.disableBypassPermissionsMode is not "disable"')
}
const agents = join(root, '.claude/agents')
if (existsSync(agents)) for (const f of readdirSync(agents).filter((x) => x.endsWith('.md'))) {
  const fm = (readFileSync(join(agents, f), 'utf8').match(/^---\n([\s\S]*?)\n---/) || [])[1] || ''
  if (!/^tools\s*:/m.test(fm)) errors.push(`AGT-7: .claude/agents/${f} has no tools: allow-list (it would inherit every tool, MCP included)`)
}
const mcp = (() => { try { return JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')) } catch { return null } })()
for (const [name, s] of Object.entries(mcp?.mcpServers || {})) {
  const argv = [s.command, ...(s.args || [])].join(' ')
  if (/\bnpx\b/.test(argv) && !/@\d+\.\d+\.\d+/.test(argv)) errors.push(`AGT-5: .mcp.json server "${name}" runs an unpinned npx package — pin an exact version`)
  if (/@latest\b/.test(argv)) errors.push(`AGT-5: .mcp.json server "${name}" uses @latest — pin an exact version`)
}
for (const e of errors) console.error(`✗ ${e}`)
console.log(`agent config: ${errors.length} problem(s)`)
process.exit(errors.length ? 1 : 0)

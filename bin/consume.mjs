#!/usr/bin/env node
// Consume an external skill / plugin / prompt / standard into this standard (sources gateway, AGT-5). Zero deps.
// The judgement (what to adopt, how to word it) is the agent's — /engineering-standard:consume drives it; this
// script does the mechanical, repeatable parts so every intake looks the same.
//
//   node bin/consume.mjs fetch <github-url> [--id <id>]   pin the commit, inventory the repo, download the files that
//        reach an agent (+ hooks/manifests) into the git-ignored local/consume/<id>/ — data to read, never to run
//   node bin/consume.mjs classify <id>                    quick/client mode for every rule drafted in
//        proposals/sources/<id>.rules.json (explicit "mode" wins; otherwise the deterministic classifier below)
//   node bin/consume.mjs apply <id> [--dry-run]           write it in: new rules + amendments into the standard,
//        plugin/modes.json, sources/registry.json, generated README/REFERENCES tables; then run every check.
//        Never commits — review `git diff` first.
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = process.env.STANDARD_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => join(ROOT, ...a)
const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'))
const writeJSON = (f, o) => writeFileSync(f, JSON.stringify(o, null, 2) + '\n')
const today = () => new Date().toISOString().slice(0, 10)

// ── fetch ────────────────────────────────────────────────────────────────────────────────────────────────────
export function parseGitHub(url) {
  const m = String(url).trim().replace(/\.git$/, '').match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.+))?)?\/?$/)
  if (!m) throw new Error(`not a GitHub repo URL: ${url}`)
  return { owner: m[1], repo: m[2], ref: m[3] || null, path: (m[4] || '').replace(/\/$/, '') }
}
async function gh(path) {
  const res = await fetch(`https://api.github.com/${path}`, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/vnd.github+json',
    'user-agent': 'engineering-standard-consume', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } })
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}${res.status === 403 ? ' (rate limit? set GITHUB_TOKEN=$(gh auth token))' : ''}`)
  return res.json()
}
const AGENT_FACING = /(^|\/)(SKILL\.md|AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|[^/]+\.mdc)$|(^|\/)(commands|agents|prompts|rules|skills|instructions)\/[^]*\.(md|mdc|txt|toml|ya?ml)$/i
const MANIFEST = /(^|\/)(\.claude-plugin\/(plugin|marketplace)\.json|\.mcp\.json|hooks\.json|[^/]*hooks[^/]*\.json|package\.json|plugin\.json|gemini-extension\.json)$/i
const EXECUTABLE = /\.(sh|bash|zsh|ps1|cmd|bat|js|mjs|cjs|ts|py|go|rb|rs)$/i
const DOC = /(^|\/)(README|LICENSE|SECURITY|CHANGELOG)[^/]*$/i
export function inventoryFiles(paths) {
  const agent = paths.filter((f) => AGENT_FACING.test(f)), manifests = paths.filter((f) => MANIFEST.test(f))
  const executable = paths.filter((f) => EXECUTABLE.test(f)), hooks = paths.filter((f) => /(^|\/)hooks?\//i.test(f))
  return { agent, manifests, executable, hooks, docs: paths.filter((f) => DOC.test(f) && f.split('/').length <= 2) }
}
async function fetchCmd(url, idArg) {
  const g = parseGitHub(url), full = `${g.owner}/${g.repo}`
  const meta = await gh(`repos/${full}`)
  const ref = g.ref || meta.default_branch
  const commit = (await gh(`repos/${full}/commits/${encodeURIComponent(ref)}`)).sha
  const tree = (await gh(`repos/${full}/git/trees/${commit}?recursive=1`)).tree.filter((t) => t.type === 'blob')
  const inScope = tree.filter((t) => !g.path || t.path === g.path || t.path.startsWith(g.path + '/'))
  const inv = inventoryFiles(inScope.map((t) => t.path))
  const id = idArg || (g.path ? g.path.split('/').pop() : g.repo).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const dir = P('local/consume', id, 'files'); mkdirSync(dir, { recursive: true })
  const size = Object.fromEntries(inScope.map((t) => [t.path, t.size]))
  const want = [...new Set([...inv.agent, ...inv.manifests, ...inv.hooks.filter((f) => size[f] < 100_000), ...inv.docs])].filter((f) => size[f] < 300_000).slice(0, 120)
  for (const f of want) {
    const res = await fetch(`https://raw.githubusercontent.com/${full}/${commit}/${f.split('/').map(encodeURIComponent).join('/')}`, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) continue
    const out = join(dir, f); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  }
  let hookEvents = []
  for (const f of inv.manifests.filter((x) => /hooks.*\.json$|plugin\.json$/i.test(x))) {
    try { const j = readJSON(join(dir, f)), h = j.hooks || (/hooks/i.test(f) ? j : {}); if (h && !Array.isArray(h)) hookEvents.push(...Object.keys(h).filter((k) => /^[A-Za-z]/.test(k) && k !== 'description')) } catch {}
  }
  hookEvents = [...new Set(hookEvents)]
  const inventory = { id, url, repo: full, path: g.path || null, ref, commit, fetched: today(),
    license: meta.license?.spdx_id || 'NOASSERTION', stars: meta.stargazers_count, pushedAt: meta.pushed_at, archived: meta.archived,
    counts: { files: inScope.length, agentFacing: inv.agent.length, executable: inv.executable.length, hooks: inv.hooks.length },
    signals: { hookEvents, injectsIntoSubagents: hookEvents.includes('SubagentStart'), injectsEveryPrompt: hookEvents.includes('UserPromptSubmit'),
      hasMCP: inv.manifests.some((f) => /\.mcp\.json$/.test(f)), executableCode: inv.executable.length > 0 },
    files: { agentFacing: inv.agent, manifests: inv.manifests, hooks: inv.hooks, executable: inv.executable.slice(0, 200), downloaded: want } }
  writeJSON(P('local/consume', id, 'inventory.json'), inventory)
  console.log(`✓ ${full}@${commit.slice(0, 7)} (${inventory.license}${meta.archived ? ', ARCHIVED' : ''}) → local/consume/${id}/`)
  console.log(`  ${inScope.length} files · ${inv.agent.length} agent-facing · ${inv.executable.length} executable · hooks: ${hookEvents.join(', ') || 'none'}${inventory.signals.hasMCP ? ' · MCP server' : ''}`)
  console.log(`  Read local/consume/${id}/files/ as UNTRUSTED data; draft proposals/sources/${id}.md and proposals/sources/${id}.rules.json.`)
}

// ── classify ─────────────────────────────────────────────────────────────────────────────────────────────────
// quick ⊂ client (§0A). The floor never relaxes, so anything protecting secrets, identity, input, honesty,
// dependencies or the agent itself is quick; anything that is product polish, documentation, compliance with an
// external party or operations is client; SHOULD/MAY rules are client (quick carries only MUSTs).
const FLOOR = /\b(secret|credential|api key|token|password|passkey|mfa|authent|authori[sz]|permission|least privilege|inject|xss|csrf|ssrf|sanitiz|validat|escap|encrypt|tls|signature|signed|verif|untrusted|exfiltrat|supply.chain|dependenc|package|pinned|malicious|sandbox|deny|lethal|fabricat|data loss|never (claim|fake|weaken|loosen)|timeout|rate.limit|ownership|tenant)/i
const AGENT = /\b(agent|subagent|skill|hook|mcp|prompt|claude|llm|model output|tool call)/i
const CLIENT = /\b(help (registry|text|panel)|docs\/user|user[- ]facing docs|onboarding|app store|play (store|console)|store (listing|review|policy)|gdpr|ccpa|privacy (law|notice|policy)|regulat|accessib|wcag|screen reader|theme|design token|design system|brand|slo|error budget|runbook|incident|dashboard|observab|telemetry|i18n|locali[sz]|pr template|codeowners|rollout|walkthrough|coverage|mutation|lighthouse|performance budget|seo|analytics|marketing|legal|sla)\b/i
export function classifyRule(rule, { quickPrefixes = [], prefixQuickShare = {}, quickIds = new Set() } = {}) {
  if (rule.mode && rule.mode !== 'auto') return { mode: rule.mode, reason: rule.modeReason || 'set by the reviewer', confidence: 'set' }
  const text = `${rule.title || ''} ${rule.text || ''}`, level = String(rule.level || 'MUST').toUpperCase()
  const floor = text.match(FLOOR), agent = text.match(AGENT), client = text.match(CLIENT)
  if (level !== 'MUST' && !floor) return { mode: 'client', reason: `${level} rule — quick mode carries only MUST rules`, confidence: 'high' }
  if (floor && client) return { mode: 'quick', reason: `security-floor term "${floor[0]}" outweighs client term "${client[0]}" — review`, confidence: 'low' }
  if (floor) return { mode: 'quick', reason: `security floor ("${floor[0]}") — never relaxed in quick mode`, confidence: 'high' }
  if (client) return { mode: 'client', reason: `client-only concern ("${client[0]}") — deferred in quick mode`, confidence: 'high' }
  if (agent) return { mode: 'quick', reason: `governs the agent itself ("${agent[0]}") — §2C applies in both modes`, confidence: 'medium' }
  if (rule.after && quickIds.has(rule.after)) return { mode: 'quick', reason: `placed with quick rule ${rule.after} and no client-only signal`, confidence: 'medium' }
  if (quickPrefixes.includes(rule.prefix)) return { mode: 'quick', reason: `${rule.prefix}-* is a quick-mode prefix`, confidence: 'medium' }
  const share = prefixQuickShare[rule.prefix]
  if (share != null && share >= 0.5) return { mode: 'quick', reason: `${Math.round(share * 100)}% of ${rule.prefix}-* rules are quick`, confidence: 'low' }
  return { mode: 'client', reason: 'no floor or agent signal — defaults to client so quick stays lean', confidence: 'low' }
}
function classifierContext() {
  const modes = readJSON(P('plugin/modes.json')), rules = readJSON(P('build/rules.json')).rules, by = {}
  for (const r of rules) { (by[r.prefix] ||= [0, 0])[0] += r.modes?.includes('quick') ? 1 : 0; by[r.prefix][1]++ }
  return { quickIds: new Set(rules.filter((r) => r.modes?.includes('quick')).map((r) => r.id)), quickPrefixes: modes.quick.prefixes || [], prefixQuickShare: Object.fromEntries(Object.entries(by).map(([p, [q, n]]) => [p, q / n])) }
}
function classifyCmd(id, { quiet = false } = {}) {
  const f = P('proposals/sources', `${id}.rules.json`)
  if (!existsSync(f)) throw new Error(`missing ${f} — draft it first (see commands/consume.md for the format)`)
  const draft = readJSON(f), ctx = classifierContext()
  for (const r of draft.newRules || []) Object.assign(r, (({ mode, reason, confidence }) => ({ mode: r.mode && r.mode !== 'auto' ? r.mode : mode, modeReason: r.modeReason || reason, modeConfidence: confidence }))(classifyRule(r, ctx)))
  writeJSON(f, draft)
  if (!quiet) for (const r of draft.newRules || []) console.log(`  ${(r.id || r.prefix + '-?').padEnd(10)} ${r.mode.padEnd(6)} ${r.modeConfidence.padEnd(6)} ${r.title} — ${r.modeReason}`)
  return draft
}

// ── apply ────────────────────────────────────────────────────────────────────────────────────────────────────
const wrap = (s, width = 108, indent = '  ') => s.split(/\s+/).reduce((lines, w) => {
  const last = lines[lines.length - 1]
  if ((last + ' ' + w).length > width && last.trim()) lines.push(indent + w); else lines[lines.length - 1] = last ? `${last} ${w}` : w
  return lines
}, ['']).join('\n')
function bulletEnd(lines, start) {                          // index after the last line of the bullet starting at `start`
  let i = start + 1
  while (i < lines.length && lines[i].startsWith('  ') && !/^\s*$/.test(lines[i])) i++
  return i
}
function findBullet(lines, id) { return lines.findIndex((l) => new RegExp(`^- \\*\\*${id} (MUST|SHOULD|MAY)\\b`).test(l)) }
function sectionEnd(lines, sec) {
  const h = lines.findIndex((l) => new RegExp(`^##+ ${sec.replace(/[.]/g, '\\.')} ·`).test(l))
  if (h < 0) throw new Error(`section §${sec} not found`)
  let last = -1
  for (let i = h + 1; i < lines.length && !/^## /.test(lines[i]); i++) if (/^- \*\*[A-Z]+-\d+ /.test(lines[i])) last = i
  if (last < 0) throw new Error(`section §${sec} has no rule bullets to append after — give "after": "<ID>"`)
  return bulletEnd(lines, last)
}
function applyCmd(id, { dryRun = false } = {}) {
  if (!existsSync(P('proposals/sources', `${id}.md`))) throw new Error(`missing proposals/sources/${id}.md — write the intake review first`)
  const draft = classifyCmd(id, { quiet: true })
  const invFile = P('local/consume', id, 'inventory.json'), inv = existsSync(invFile) ? readJSON(invFile) : {}
  const reg = readJSON(P('sources/registry.json')), modes = readJSON(P('plugin/modes.json'))
  const name = draft.name || inv.repo?.split('/')[1] || id, cite = `*(source: ${name})*`
  let md = readFileSync(P('ENGINEERING_STANDARD.md'), 'utf8'); let lines = md.split('\n')
  const maxN = (prefix) => Math.max(0, ...[...md.matchAll(new RegExp(`\\*\\*${prefix}-(\\d+) (?:MUST|SHOULD|MAY)`, 'g'))].map((m) => +m[1]))
  const added = [], amended = []
  if (!['reference', 'rejected'].includes(draft.disposition)) {
    for (const r of draft.newRules || []) {
      if (!/^[A-Z]+$/.test(r.prefix || '')) throw new Error(`new rule "${r.title}": prefix must be uppercase letters`)
      r.id ||= `${r.prefix}-${maxN(r.prefix) + 1 + added.filter((x) => x.startsWith(r.prefix + '-')).length}`
      if (findBullet(lines, r.id) >= 0) throw new Error(`${r.id} already exists`)
      const at = r.after ? (() => { const b = findBullet(lines, r.after); if (b < 0) throw new Error(`after: ${r.after} not found`); return bulletEnd(lines, b) })() : sectionEnd(lines, r.section)
      const level = String(r.level || 'MUST').toUpperCase()
      lines.splice(at, 0, wrap(`- **${r.id} ${level}** **${r.title.replace(/\.$/, '')}.** ${r.text.trim()} ${cite}`))
      added.push(r.id)
    }
    for (const a of draft.amendments || []) {
      const b = findBullet(lines, a.id); if (b < 0) throw new Error(`amendment target ${a.id} not found`)
      const e = bulletEnd(lines, b) - 1
      lines[e] = lines[e] + ' ' + a.append.trim() + ` ${cite}`
      const whole = lines.slice(b, e + 1).join(' ').replace(/\s+/g, ' ')         // re-wrap the whole bullet
      lines.splice(b, e - b + 1, ...wrap(whole).split('\n'))
      amended.push(a.id)
    }
  }
  const quickNew = (draft.newRules || []).filter((r) => r.mode === 'quick' && !modes.quick.prefixes.includes(r.prefix)).map((r) => r.id)
  const entry = { id, name, author: draft.author || inv.repo?.split('/')[0], repo: draft.repo || inv.repo, url: draft.url || inv.url,
    commit: draft.commit || inv.commit, ...(draft.version ? { version: draft.version } : {}), reviewed: today(),
    license: draft.license || inv.license, kind: draft.kind, disposition: draft.disposition,
    paths: draft.paths || inv.files?.agentFacing?.slice(0, 20) || [], informs: [...new Set([...(draft.informs || []), ...added, ...amended])],
    ...(draft.also ? { also: draft.also } : {}), ...(draft.companion ? { companion: draft.companion } : {}), ...(draft.notes ? { notes: draft.notes } : {}) }
  const summary = { added, amended, quick: (draft.newRules || []).filter((r) => r.mode === 'quick').map((r) => r.id), registry: entry.disposition }
  if (dryRun) { console.log(JSON.stringify({ ...summary, entry }, null, 2)); return summary }
  writeFileSync(P('ENGINEERING_STANDARD.md'), lines.join('\n'))
  if (quickNew.length) { modes.quick.ids = [...new Set([...modes.quick.ids, ...quickNew])]; writeJSON(P('plugin/modes.json'), modes) }
  const i = reg.sources.findIndex((s) => s.id === id); if (i >= 0) reg.sources[i] = entry; else reg.sources.push(entry)
  writeJSON(P('sources/registry.json'), reg)
  writeJSON(P('proposals/sources', `${id}.rules.json`), { ...draft, applied: today(), newRules: draft.newRules })
  const run = (f, ...a) => { try { return { ok: true, out: execFileSync('node', [P(f), ...a], { cwd: ROOT, encoding: 'utf8' }) } } catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` } } }
  run('bin/build-rules.mjs'); run('bin/sources.mjs', '--render')
  const checks = [['build-rules --check', run('bin/build-rules.mjs', '--check')], ['sources --check', run('bin/sources.mjs', '--check')], ['check-public', run('bin/check-public.mjs')]]
  console.log(`✓ applied ${id}: ${added.length} new rule(s) ${added.join(' ')}${amended.length ? ` · amended ${amended.join(' ')}` : ''} · disposition ${entry.disposition}`)
  for (const [n, r] of checks) console.log(`${r.ok ? '  ✓' : '  ✗'} ${n}\n${r.out.trim().split('\n').map((l) => '    ' + l).join('\n')}`)
  console.log('  Review `git diff`, resolve any cross-mode warning (reword or add a reviewedPointers entry), then commit.')
  return { ...summary, checks: checks.map(([n, r]) => [n, r.ok]) }
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {   // run directly (symlink-safe)
  const [cmd, arg] = process.argv.slice(2), flag = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined }
  try {
    if (cmd === 'fetch' && arg) await fetchCmd(arg, flag('--id'))
    else if (cmd === 'classify' && arg) classifyCmd(arg)
    else if (cmd === 'apply' && arg) { const r = applyCmd(arg, { dryRun: process.argv.includes('--dry-run') }); if (r.checks?.some(([, ok]) => !ok)) process.exit(1) }
    else { console.error('usage: consume.mjs fetch <github-url> [--id <id>] | classify <id> | apply <id> [--dry-run]'); process.exit(2) }
  } catch (e) { console.error(`✗ ${e.message}`); process.exit(1) }
}

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
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = process.env.STANDARD_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => join(ROOT, ...a)
const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'))
const writeJSON = (f, o) => writeFileSync(f, JSON.stringify(o, null, 2) + '\n')
const today = () => new Date().toISOString().slice(0, 10)

// ── fetch ────────────────────────────────────────────────────────────────────────────────────────────────────
// Everything that comes from the fetched repo is untrusted: printed and stored only after `clean()` (no control,
// escape or bidi characters — they could rewrite the terminal or hide text from the reviewing agent).
export const clean = (v, max = 160) => String(v ?? '').replace(new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]', 'g'), '?').slice(0, max)
const EVENT = /^[A-Za-z][A-Za-z0-9_-]{1,40}$/
export function parseGitHub(url) {
  const m = String(url).trim().replace(/\.git$/, '').match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/(.+?))?\/?$/)
  if (!m) throw new Error(`not a GitHub repo URL: ${clean(url)}`)
  const rest = m[3] || '', segs = rest ? rest.split('/') : []
  // ref vs path is ambiguous when a branch name contains '/' — fetch resolves it against GitHub (resolveRef).
  return { owner: m[1], repo: m[2], rest, ref: segs[0] || null, path: segs.slice(1).join('/') }
}
async function gh(path) {
  const res = await fetch(`https://api.github.com/${path}`, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/vnd.github+json',
    'user-agent': 'engineering-standard-consume', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } })
  if (!res.ok) { const e = new Error(`GitHub ${res.status} for ${clean(path)}${res.status === 403 ? ' (rate limit? set GITHUB_TOKEN=$(gh auth token))' : ''}`); e.status = res.status; throw e }
  return res.json()
}
async function resolveRef(full, rest, defaultBranch) {
  if (!rest) return { ref: defaultBranch, path: '', commit: (await gh(`repos/${full}/commits/${encodeURIComponent(defaultBranch)}`)).sha }
  const segs = rest.split('/')
  for (let k = segs.length; k >= 1; k--) {                    // longest ref first, as GitHub does
    const ref = segs.slice(0, k).join('/')
    try { return { ref, path: segs.slice(k).join('/'), commit: (await gh(`repos/${full}/commits/${encodeURIComponent(ref)}`)).sha } }
    catch (e) { if (e.status !== 404 && e.status !== 422) throw e }
  }
  throw new Error(`no branch, tag or commit matches "${clean(rest)}"`)
}
const AGENT_FACING = /(^|\/)(SKILL\.md|AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|[^/]+\.mdc)$|(^|\/)(commands|agents|prompts|rules|skills|instructions|output-styles)\/[^]*\.(md|mdc|txt|toml|ya?ml)$/i
const MANIFEST = /(^|\/)(\.claude-plugin\/(plugin|marketplace)\.json|\.mcp\.json|hooks\.json|[^/]*hooks[^/]*\.json|package\.json|plugin\.json|gemini-extension\.json|\.claude\/settings(\.local)?\.json|settings\.json)$/i
const EXECUTABLE = /\.(sh|bash|zsh|ps1|cmd|bat|js|mjs|cjs|ts|py|go|rb|rs)$/i
const DOC = /(^|\/)(README|LICENSE|SECURITY|CHANGELOG)[^/]*$/i
export function inventoryFiles(paths) {
  const agent = paths.filter((f) => AGENT_FACING.test(f)), manifests = paths.filter((f) => MANIFEST.test(f))
  const executable = paths.filter((f) => EXECUTABLE.test(f)), hooks = paths.filter((f) => /(^|\/)hooks?\//i.test(f))
  return { agent, manifests, executable, hooks, docs: paths.filter((f) => DOC.test(f) && f.split('/').length <= 2) }
}
// Paths a plugin manifest points at (Claude Code lets commands/agents/skills/hooks/mcpServers live anywhere).
export function manifestRefs(manifestPath, j) {
  const root = manifestPath.replace(/(^|\/)\.[\w-]+-plugin\/[^/]+$/, '$1').replace(/[^/]*$/, (m) => /\.json$/.test(m) ? '' : m)
  const tidy = (p) => String(p).replace(/\/\.(?=\/|$)/g, '').replace(/^\.\//, '').replace(/\/+$/, '')
  const norm = (p) => tidy(root + tidy(p))
  const out = []
  for (const k of ['commands', 'agents', 'skills', 'outputStyles', 'hooks', 'mcpServers']) {
    const v = j?.[k]
    for (const x of typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((y) => typeof y === 'string') : []) out.push({ kind: k, path: norm(x), raw: tidy(x) })
  }
  return out
}
async function fetchCmd(url, idArg) {
  const g = parseGitHub(url), full = `${g.owner}/${g.repo}`
  const meta = await gh(`repos/${full}`)
  const { ref, path: scope, commit } = await resolveRef(full, g.rest, meta.default_branch)
  const tree = (await gh(`repos/${full}/git/trees/${commit}?recursive=1`))
  const blobs = tree.tree.filter((t) => t.type === 'blob')
  const inScope = blobs.filter((t) => !scope || t.path === scope || t.path.startsWith(scope + '/'))
  const inv = inventoryFiles(inScope.map((t) => t.path))
  const id = idArg || (scope ? scope.split('/').pop() : g.repo).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`bad id "${clean(id)}"`)
  rmSync(P('local/consume', id), { recursive: true, force: true })      // no files left over from an earlier commit
  const dir = P('local/consume', id, 'files'); mkdirSync(dir, { recursive: true })
  const size = Object.fromEntries(blobs.map((t) => [t.path, t.size])), unread = [], unparsed = [], got = new Set()
  if (tree.truncated) unread.push('(GitHub truncated the file list — the repo is too large to inventory completely)')
  const download = async (f) => {
    if (got.has(f)) return
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${full}/${commit}/${f.split('/').map(encodeURIComponent).join('/')}`, { signal: AbortSignal.timeout(20000) })
      if (!res.ok) { unread.push(`${f} (HTTP ${res.status})`); return }
      const out = join(dir, f); if (!out.startsWith(dir + '/')) { unread.push(`${f} (path escapes the download folder)`); return }
      mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, Buffer.from(await res.arrayBuffer())); got.add(f)
    } catch (e) { unread.push(`${f} (${e.name === 'TimeoutError' ? 'timeout' : e.message})`) }
  }
  // Manifests first and always (any size): every security signal comes from them.
  for (const f of inv.manifests) await download(f)
  // Follow paths a manifest points at; a pointer to something we can't find means the inventory is incomplete.
  const refs = []
  for (const f of inv.manifests.filter((x) => /plugin\.json$/i.test(x))) {
    try { refs.push(...manifestRefs(f, readJSON(join(dir, f)))) } catch (e) { unparsed.push(`${f} (${e.code === 'ENOENT' ? 'not downloaded' : 'not valid JSON'})`) }
  }
  const extra = []
  for (const r of refs) {
    const under = (base) => blobs.map((t) => t.path).filter((p) => p === base || p.startsWith(base + '/'))
    let hits = under(r.path)
    if (!hits.length && r.raw) hits = under(r.raw)                  // some formats resolve from the repo root
    if (!hits.length) unparsed.push(`${r.path} (declared as ${r.kind} in a plugin manifest, not found in the repo)`)
    for (const h of hits) { extra.push(h); if (r.kind === 'hooks' || r.kind === 'mcpServers') inv.manifests.includes(h) || inv.manifests.push(h); else if (!inv.agent.includes(h)) inv.agent.push(h) }
  }
  const rest = [...new Set([...inv.agent, ...extra, ...inv.hooks, ...inv.docs])].filter((f) => !got.has(f))
  const MAX = 200, small = rest.filter((f) => (size[f] ?? 0) < 300_000)
  unread.push(...rest.filter((f) => (size[f] ?? 0) >= 300_000).map((f) => `${f} (over 300 KB)`), ...small.slice(MAX).map((f) => `${f} (over the ${MAX}-file limit)`))
  for (const f of small.slice(0, MAX)) await download(f)
  for (const f of extra.filter((x) => /\.json$/i.test(x) && !got.has(x))) await download(f)
  // A single skill fetched from a plugin repo: the repo's own hooks still run if the whole plugin is installed.
  const repoHookEvents = []
  if (scope) {
    const rootManifests = inventoryFiles(blobs.map((t) => t.path)).manifests.filter((f) => !f.startsWith(scope + '/') && f.split('/').length <= 3 && /hooks.*\.json$|plugin\.json$/i.test(f))
    for (const f of rootManifests) {
      await download(f)
      try { const j = readJSON(join(dir, f)), h = j.hooks && typeof j.hooks === 'object' ? j.hooks : (/hooks/i.test(f) ? j : null)
        if (h && !Array.isArray(h)) repoHookEvents.push(...Object.keys(h).filter((k) => EVENT.test(k))) } catch { unparsed.push(`${f} (repo-level manifest unreadable)`) }
    }
  }
  let hookEvents = []
  for (const f of inv.manifests.filter((x) => /hooks.*\.json$|plugin\.json$|settings(\.local)?\.json$/i.test(x))) {
    try {
      const j = readJSON(join(dir, f)), h = j.hooks && typeof j.hooks === 'object' ? j.hooks : (/hooks/i.test(f) ? j : null)
      if (Array.isArray(h)) { for (const e of h) if (e && typeof e === 'object') hookEvents.push(...Object.values(e).filter((v) => typeof v === 'string' && EVENT.test(v) && /start|stop|submit|tool|prompt|session|compact|notification/i.test(v))) }
      else if (h) { const keys = Object.keys(h).filter((k) => k !== 'description'); hookEvents.push(...keys.filter((k) => EVENT.test(k))); if (keys.some((k) => !EVENT.test(k))) unparsed.push(`${f} (hook keys that are not event names)`) }
    } catch (e) { unparsed.push(`${f} (${e.code === 'ENOENT' ? 'not downloaded' : 'not valid JSON'})`) }
  }
  hookEvents = [...new Set(hookEvents)]
  const hookCode = inv.hooks.length > 0 || inv.executable.some((f) => /hook/i.test(f)) || refs.some((r) => r.kind === 'hooks')
  const complete = !tree.truncated && !unread.some((u) => MANIFEST.test(u.split(' (')[0]) || /hook/i.test(u)) && !unparsed.length
  const hooksSignal = hookEvents.length ? 'present' : (hookCode || !complete ? 'unknown — inspect manually' : 'none')
  const yesNo = (hit) => hit ? true : (hooksSignal === 'none' || complete) ? false : 'unknown'
  const C = (xs) => xs.map((x) => clean(x, 300))
  const inventory = { id, url: clean(url, 300), repo: full, path: scope || null, ref: clean(ref), commit, fetched: today(),
    license: clean(meta.license?.spdx_id || 'NOASSERTION', 40), stars: meta.stargazers_count, pushedAt: meta.pushed_at, archived: meta.archived,
    counts: { files: inScope.length, agentFacing: inv.agent.length, executable: inv.executable.length, hooks: inv.hooks.length },
    signals: { hooks: hooksSignal, hookEvents, repoLevelHookEvents: [...new Set(repoHookEvents)], injectsIntoSubagents: yesNo(hookEvents.includes('SubagentStart')),
      injectsEveryPrompt: yesNo(hookEvents.some((e) => /UserPromptSubmit|userPromptSubmitted|beforeSubmitPrompt/.test(e))),
      hasMCP: inv.manifests.some((f) => /\.mcp\.json$/.test(f)) || refs.some((r) => r.kind === 'mcpServers') || null, executableCode: inv.executable.length > 0, complete },
    unread: C(unread), unparsed: C(unparsed),
    files: { agentFacing: C(inv.agent), manifests: C(inv.manifests), hooks: C(inv.hooks), executable: C(inv.executable.slice(0, 200)), downloaded: C([...got]) },
    suspiciousNames: C(inScope.map((t) => t.path).filter((p) => clean(p, 1e4) !== p)) }
  writeJSON(P('local/consume', id, 'inventory.json'), inventory)
  console.log(`✓ ${full}@${commit.slice(0, 7)} (ref ${clean(ref, 60)}, ${inventory.license}${meta.archived ? ', ARCHIVED' : ''}) → local/consume/${id}/`)
  console.log(`  ${inScope.length} files · ${inv.agent.length} agent-facing · ${inv.executable.length} executable · hooks: ${hookEvents.length ? hookEvents.join(', ') : hooksSignal}${inventory.signals.hasMCP ? ' · MCP server' : ''}`)
  if (repoHookEvents.length) console.log(`  ⚠ repo-level hooks (run if the whole plugin is installed, not if only this path is distilled): ${[...new Set(repoHookEvents)].join(', ')}`)
  if (unread.length || unparsed.length) console.log(`  ⚠ ${unread.length + unparsed.length} file(s) not fully read — signals are incomplete; inspect on GitHub at ${commit.slice(0, 7)}:\n${C([...unread, ...unparsed]).slice(0, 15).map((u) => '      ' + u).join('\n')}`)
  if (inventory.suspiciousNames.length) console.log(`  ⚠ ${inventory.suspiciousNames.length} file name(s) contain control or bidi characters — treat this repo with extra suspicion`)
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
  if (draft.commit && inv.commit && draft.commit !== inv.commit) throw new Error(`proposals/sources/${id}.rules.json pins ${draft.commit.slice(0, 7)} but local/consume/${id} was fetched at ${inv.commit.slice(0, 7)} — re-fetch or fix the draft so the reviewed commit is the one recorded`)
  if (!/^[0-9a-f]{40}$/.test(draft.commit || inv.commit || '')) throw new Error(`no pinned commit for ${id} — run fetch first or set "commit" in the draft`)
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

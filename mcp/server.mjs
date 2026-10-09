#!/usr/bin/env node
// engineering-standard MCP server — stdio, newline-delimited JSON-RPC 2.0, zero dependencies.
// Local only: no listener, no secrets. Only verify_dependency makes outbound calls (registries + OSV).
import { createInterface } from 'node:readline'
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, loadRules, rulesFor, ruleById, readJSON, kitVersion } from '../lib/rules.mjs'
import { verifyDependency, ECOSYSTEMS } from '../lib/deps.mjs'
import { resolveMode, loadModes, PROMOTION_TRIGGERS } from '../lib/modes.mjs'
import { runSemgrep } from '../lib/semgrep.mjs'

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const projectRoot = (p) => resolve(p || process.env.CLAUDE_PROJECT_DIR || process.cwd())

const TOOLS = [
  { name: 'rules_for', description: 'Standard rules that apply to the given stacks in the repo\'s mode (optionally filtered by topic words). Compact list; use `rule` for full text.',
    inputSchema: { type: 'object', properties: {
      stacks: { type: 'array', items: { type: 'string' }, description: 'e.g. ["flutter","supabase"]; "all" = core rules' },
      topic: { type: 'string', description: 'keywords, e.g. "auth session"' },
      mode: { type: 'string', enum: ['quick', 'client'], description: 'default: the repo\'s declared mode (see `mode`)' },
      level: { type: 'string', enum: ['MUST', 'SHOULD', 'MAY'] },
      include_core: { type: 'boolean', description: 'include rules tagged all (default true)' } }, required: ['stacks'] },
    annotations: { readOnlyHint: true } },
  { name: 'rule', description: 'Full text of one rule ID, its references, ASVS 5.0 requirements it closes and how it is enforced.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'e.g. SEC-4' } }, required: ['id'] }, annotations: { readOnlyHint: true } },
  { name: 'check', description: 'Run the kit checks on paths: semgrep banned-API rules (if installed) and the TEST-7 feature→test map (if standard.config.json exists). Structured findings.',
    inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } }, repo_path: { type: 'string' } }, required: ['paths'] },
    annotations: { readOnlyHint: true } },
  { name: 'verify_dependency', description: 'Before adding a package: existence, version age vs 7-day cooldown, deprecation, OSV advisories, typosquat hint.',
    inputSchema: { type: 'object', properties: {
      ecosystem: { type: 'string', enum: ECOSYSTEMS }, name: { type: 'string' }, version: { type: 'string' },
      security_fix: { type: 'boolean', description: 'true only when this version fixes a vulnerability (cooldown exempt, VULN-5)' } }, required: ['ecosystem', 'name'] },
    annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'exception_add', description: 'Record a deviation in <repo>/docs/STANDARD_EXCEPTIONS.md (rule must exist; expiry a future ISO date).',
    inputSchema: { type: 'object', properties: {
      rule: { type: 'string' }, reason: { type: 'string' }, owner: { type: 'string' }, expiry: { type: 'string', description: 'YYYY-MM-DD' },
      repo_path: { type: 'string' }, where: { type: 'string', description: 'file/area the exception covers' } }, required: ['rule', 'reason', 'owner', 'expiry', 'repo_path'] },
    annotations: { destructiveHint: false } },
  { name: 'review_plan', description: 'APP_REVIEW.md lens roster for a profile: quick | standard | full (deep = full). Default from the mode: quick→quick, client→standard.',
    inputSchema: { type: 'object', properties: { profile: { type: 'string', enum: ['quick', 'standard', 'full', 'deep'] } } },
    annotations: { readOnlyHint: true } },
  { name: 'mode', description: 'The repo\'s standard mode (quick | client), where it was set, and the ENF-4 triggers that require client mode.',
    inputSchema: { type: 'object', properties: { repo_path: { type: 'string' } } }, annotations: { readOnlyHint: true } },
]

// ── tool implementations ────────────────────────────────────────────────────────────────────────
function toolRulesFor({ stacks, topic, level, include_core, mode }) {
  if (!Array.isArray(stacks) || !stacks.length) throw new Error('stacks must be a non-empty array')
  const m = resolveMode({ arg: mode, root: projectRoot() })
  const any = rulesFor({ stacks, topic, level, include_core }), all = any.filter((r) => r.modes.includes(m.mode)), LIMIT = 120
  const lines = all.slice(0, LIMIT).map((r) => `${r.id} ${r.levelText} — ${r.title}`)
  const head = `${all.length} rule(s) for [${stacks.join(', ')}]${topic ? ` topic "${topic}"` : ''}, mode: ${m.mode} (${m.source}) (v${loadRules().version}). Full text: rule(id).`
  const note = m.mode === 'quick' ? [`quick mode — ${any.length - all.length} client-only rules deferred; they apply once ENF-4's triggers hold`] : []
  return [head, ...note, ...lines, ...(all.length > LIMIT ? [`… +${all.length - LIMIT} more — narrow with topic/level or include_core:false`] : [])].join('\n')
}

function toolMode({ repo_path } = {}) {
  const m = resolveMode({ root: projectRoot(repo_path) }), enf4 = ruleById('ENF-4'), c = loadRules().counts.byMode
  return { ...m, valid: loadModes().modes, default: loadModes().default, rules: { quick: c.quick.total, client: c.client.total },
    set: 'standard.config.json → "mode", or env STANDARD_MODE', promoteToClientWhenAny: PROMOTION_TRIGGERS,
    ...(enf4 ? { 'ENF-4': enf4.text } : { note: 'ENF-4 not yet defined in this kit version' }) }
}

let asvs
function toolRule({ id }) {
  const r = ruleById(id || '')
  if (!r) {
    const p = String(id || '').toUpperCase().split('-')[0]
    const near = loadRules().rules.filter((x) => x.prefix === p).map((x) => x.id)
    throw new Error(`unknown rule ${id}${near.length ? ` — ${p} has ${near[0]}…${near.at(-1)}` : ''}`)
  }
  asvs ??= readJSON(join(ROOT, 'mappings/asvs-map.json'))
  const reqs = asvs.filter((a) => (a.rules || []).includes(r.id)).map((a) => ({ req: a.req_id, level: a.L, status: a.status }))
  return { ...r, asvs: reqs, enforcedBy: r.enforcedBy || [], source: `ENGINEERING_STANDARD.md § ${r.section}${r.subsection ? ' › ' + r.subsection : ''}` }
}

function toolCheck({ paths, repo_path }) {
  const cwd = projectRoot(repo_path), m = resolveMode({ root: cwd }), out = { repo: cwd, mode: `${m.mode} (${m.source})`, semgrep: null, tests: null, findings: [] }
  if (!Array.isArray(paths) || !paths.length) throw new Error('paths must be a non-empty array')
  const files = []
  const walk = (p) => {
    const abs = resolve(cwd, p)
    if (!existsSync(abs)) return
    try { for (const e of readdirSync(abs)) if (!['node_modules', '.git', 'build', 'dist', '.dart_tool', '.next', 'Pods'].includes(e)) walk(join(p, e)) } catch { files.push(p) }
  }
  for (const p of paths) walk(p)
  const sg = runSemgrep(files.slice(0, 2000), { cwd, timeoutMs: 120000 })
  out.semgrep = sg.available ? { ran: true, files: files.length, baselined: sg.baselined || 0, errors: sg.error ? [sg.error] : sg.errors } : { ran: false, message: sg.error }
  // Lint is the same floor in every mode; in quick mode, mark findings that cite only client-only rules.
  const clientOnly = (ids) => ids.length && ids.every((id) => ruleById(id) && !ruleById(id).modes.includes('quick'))
  out.findings.push(...sg.findings.map((f) => ({ tool: 'semgrep', ...f, ...(m.mode === 'quick' && clientOnly(f.standard || []) ? { clientOnly: true } : {}) })))
  const cfg = join(cwd, 'standard.config.json')
  if (existsSync(cfg)) {
    const r = spawnSync(process.execPath, [join(ROOT, 'bin/check-tests.mjs'), '--config', cfg, '--mode', m.mode], { cwd, encoding: 'utf8', timeout: 60000 })
    out.tests = { ran: true, exitCode: r.status, output: (r.stdout + r.stderr).trim().split('\n').slice(-40).join('\n') }
    const tr = m.mode === 'quick' ? 'TEST-14' : 'TEST-7'
    if (r.status) out.findings.push({ tool: 'check-tests', rule: tr, standard: [tr], message: 'features missing a required test kind — see tests.output' })
  } else out.tests = { ran: false, message: 'no standard.config.json — TEST-7 check skipped' }
  const deferred = out.findings.filter((f) => f.clientOnly).length
  out.summary = `${out.findings.length} finding(s)${deferred ? ` (${deferred} cite only client-only rules — deferred in quick mode)` : ''}${sg.available ? '' : '; semgrep NOT run (not installed)'}`
  return out
}

function toolExceptionAdd({ rule, reason, owner, expiry, repo_path, where }) {
  const r = ruleById(rule || '')
  if (!r) throw new Error(`unknown rule ${rule} — exceptions must cite a defined rule ID`)
  if (!reason?.trim() || !owner?.trim()) throw new Error('reason and owner are required')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry || '') || Number.isNaN(Date.parse(expiry + 'T00:00:00Z'))) throw new Error('expiry must be an ISO date YYYY-MM-DD')
  if (Date.parse(expiry + 'T23:59:59Z') <= Date.now()) throw new Error(`expiry ${expiry} is not in the future`)
  if (!repo_path || !existsSync(repo_path)) throw new Error(`repo_path ${repo_path} does not exist`)
  const file = join(resolve(repo_path), 'docs/STANDARD_EXCEPTIONS.md')
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
  if (!existsSync(file)) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, '# Standard exceptions\n\n| Rule | Where | Reason | Owner | Expires |\n|---|---|---|---|---|\n') }
  const cur = readFileSync(file, 'utf8')
  const row = `| ${r.id} | ${cell(where || '—')} | ${cell(reason)} | ${cell(owner)} | ${expiry} |\n`
  appendFileSync(file, (cur.endsWith('\n') ? '' : '\n') + row)
  return { added: row.trim(), file, rule: { id: r.id, level: r.levelText, title: r.title },
    note: r.level === 'MUST' ? 'MUST rule: an exception needs a compensating control and a P1 review finding until fixed (§8).' : undefined }
}

function toolReviewPlan({ profile } = {}) {
  const m = profile ? null : resolveMode({ root: projectRoot() })
  const p = profile === 'deep' ? 'full' : profile || (m.mode === 'quick' ? 'quick' : 'standard')
  if (!['quick', 'standard', 'full'].includes(p)) throw new Error('profile must be quick | standard | full (deep)')
  const md = readFileSync(join(ROOT, 'APP_REVIEW.md'), 'utf8')
  const sec = md.slice(md.search(/^## 6 · Lens roster/m), md.search(/^## 7 /m))
  const lenses = []
  for (const l of sec.split('\n')) {
    const c = l.split(/(?<!\\)\|/).map((x) => x.trim())
    const m = c[1]?.match(/^\*\*(L\d+)\s*·\s*([^*]+?)\*\*/)
    if (m) lenses.push({ key: m[1], name: m[2].trim(), questions: c[2], scope: c[3], mission: c[4] })
  }
  const prof = {}
  for (const m of sec.matchAll(/^- \*\*(\w+)\*\* \(([^)]*)\) — (.*)$/gm)) prof[m[1]] = { when: m[2], rule: m[3] }
  const def = prof[p]
  if (!def) throw new Error(`profile ${p} not found in APP_REVIEW.md §6`)
  const named = new Set(def.rule.match(/L\d+/g) || [])
  const all = /all lenses|the rest/.test(def.rule)
  const active = lenses.filter((l) => all || named.has(l.key)).map((l) => ({ ...l,
    fanOut: p === 'full' && named.has(l.key) && /group/i.test(l.scope) ? 'one agent per menu-group' : 'app-wide' }))
  const preamble = (sec.match(/\*\*Shared preamble[^\n]*\n\n((?:>.*\n?)+)/) || [, ''])[1].replace(/^> ?/gm, '').trim()
  return { profile: p, ...(m ? { mode: `${m.mode} (${m.source})` } : {}), when: def.when, selection: def.rule, lenses: active, preamble,
    steps: ['Phase −1 auto-detect stack + kit evidence (APP_REVIEW.md)', 'Phase 0 shared context', 'one read-only agent per lens (agents/standard-reviewer.md), findings in the §7 schema citing rule IDs',
      'verify every P0/P1 claim', 'synthesize report per §10; release gate §9'] }
}

const IMPL = { rules_for: toolRulesFor, rule: toolRule, check: toolCheck, verify_dependency: verifyDependency, exception_add: toolExceptionAdd, review_plan: toolReviewPlan, mode: toolMode }

// ── JSON-RPC plumbing ───────────────────────────────────────────────────────────────────────────
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')
const ok = (id, result) => send({ id, result })
const fail = (id, code, message) => send({ id, error: { code, message } })

async function handle(msg) {
  const { id, method, params = {} } = msg
  const isReq = id !== undefined && id !== null
  switch (method) {
    case 'initialize': {
      const v = SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0]
      return ok(id, { protocolVersion: v, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'engineering-standard', version: kitVersion() },
        instructions: 'Rules of ENGINEERING_STANDARD.md for the repo\'s mode (quick ⊂ client; see mode). Use rules_for/rule instead of guessing a rule; verify_dependency before adding any package; cite rule IDs.' })
    }
    case 'notifications/initialized': case 'notifications/cancelled': return
    case 'ping': return ok(id, {})
    case 'tools/list': return ok(id, { tools: TOOLS })
    case 'tools/call': {
      const fn = IMPL[params.name]
      if (!fn) return fail(id, -32602, `unknown tool ${params.name}`)
      try {
        const res = await fn(params.arguments || {})
        const text = typeof res === 'string' ? res : JSON.stringify(res)
        return ok(id, { content: [{ type: 'text', text }], isError: false })
      } catch (e) { return ok(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }) }
    }
    default:
      if (isReq) return fail(id, -32601, `method not found: ${method}`)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', async (line) => {
  if (!line.trim()) return
  let msg
  try { msg = JSON.parse(line) } catch { return fail(null, -32700, 'parse error') }
  for (const m of Array.isArray(msg) ? msg : [msg]) {
    if (m?.jsonrpc !== '2.0' || typeof m.method !== 'string') { if (m && 'id' in m && !('result' in m || 'error' in m)) fail(m.id ?? null, -32600, 'invalid request'); continue }
    await handle(m).catch((e) => m.id != null && fail(m.id, -32603, e.message))
  }
})

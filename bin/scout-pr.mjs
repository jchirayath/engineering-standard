#!/usr/bin/env node
// The owner's decisions on the daily scout as GitHub pull requests (standard §7.5). Zero deps. bin/scout-jobs.sh
// (the wrapper, never the agent) builds one branch per proposal from origin/main, applies it, runs the checks and
// opens a PR whose description says what the source is, what changes in the standard and a recommendation.
// Merge = approve · close with a comment = reject (the comment is the reason) · label "hold" = watch. The next run
// reads those back (`sync`) into sources/candidates.json.
//
//   node bin/scout-pr.mjs pending                       proposals that need a PR (or a rebuild): "source <id>" / "standard <name>"
//   node bin/scout-pr.mjs title|body source <id> [--checks FILE]     PR title / description for a source proposal
//   node bin/scout-pr.mjs title|body standard <name> [--checks FILE] … for proposals/standards/<name>.json
//   node bin/scout-pr.mjs body ledger [--base FILE]     description of the rolling ledger PR (FILE: main's candidates.json)
//   node bin/scout-pr.mjs apply-standard <name>         amend the standard from proposals/standards/<name>.json, run the checks
//   node bin/scout-pr.mjs record <kind:name> --number N --url URL --branch B [--rec approve|hold|reject]
//   node bin/scout-pr.mjs sync --repo owner/name        (network) merged / closed / hold → the ledger
//
// Everything in a proposal was written by an agent that read untrusted web content: it is rendered as data (no HTML,
// no images, no @-mentions) and the recommendation can only be made stricter by the agent, never looser.
import { readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { clean, amendLines } from './consume.mjs'
import { nextReview } from './scout.mjs'

const ROOT = process.env.STANDARD_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => join(ROOT, ...a)
const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'))
const writeJSON = (f, o) => writeFileSync(f, JSON.stringify(o, null, 2) + '\n')
const today = () => process.env.SCOUT_TODAY || new Date().toISOString().slice(0, 10)
const NAME = /^[a-z0-9][a-z0-9-]{0,80}$/
const REPO = /^(?!\.{1,2}\/)[\w.-]+\/(?!\.{1,2}$)[\w.-]+$/
export const HOLD_LABEL = 'hold'
const BODY_MAX = 60_000                                   // GitHub's limit is 65 536 characters

// ── rendering untrusted text safely into Markdown ───────────────────────────────────────────────────────────
// No raw HTML or images (tracking pixels, hidden text), no @-mentions (they notify real people), no control chars.
export function safeMd(s, max = 4000) {
  return clean(s, max)                                    // control/bidi characters → '?'
    .replace(/!\[/g, '!\\[')                               // every image form (inline, reference) becomes text
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/@(?=[A-Za-z0-9-])/g, '@​')               // every @-mention, even after a lone backtick
}
const RULE_ID = /^[A-Z]+-\d+$/
const multiline = (s, max) => String(s ?? '').split('\n').map((l) => safeMd(l, 2000)).join('\n').slice(0, max)
const quote = (s, max = 3000) => multiline(s, max).split('\n').map((l) => `> ${l}`).join('\n')
const amendmentsOf = (draft) => (Array.isArray(draft.amendments) ? draft.amendments : []).map((a) => `- **${RULE_ID.test(a.id || '') ? a.id : '(invalid id)'}** gains:\n${quote(a.append)}`)

// ── the recommendation (pure) ───────────────────────────────────────────────────────────────────────────────
// Floor from the facts: failing checks or gates → reject; matrix watch → hold; otherwise approve. The agent's own
// `recommendation` may only move it stricter (approve → hold → reject). Cautions become a merge checklist.
const RANK = { approve: 0, hold: 1, reject: 2 }
export function notVerified(md = '') {
  const m = String(md).match(/\*\*Not verified:?\*\*:?\s*([\s\S]*?)(?:\n\s*\n|$)/i)
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}
export function recommend({ kind, entry = null, draft = {}, md = '', checksOk = true }) {
  const why = [], cautions = []
  let verdict = 'approve'
  const stricter = (v, reason) => { if (RANK[v] > RANK[verdict]) verdict = v; why.push(reason) }
  if (checksOk === false) stricter('reject', 'The change fails the repo checks on this branch, so it cannot be merged as it is.')
  if (kind === 'source') {
    if (entry?.gatesFailed?.length) stricter('reject', `It fails hard gate(s) ${entry.gatesFailed.join(', ')}.`)
    else if (entry?.outcome === 'reject') stricter('reject', `The matrix scored it ${entry.total ?? '–'}/100 (reject).`)
    else if (entry?.outcome === 'watch') stricter('hold', `The matrix scored it ${entry.total ?? '–'}/100 (watch), below the consume line.`)
    for (const w of entry?.warnings || []) cautions.push(`Gate warning: ${w}`)
    if (entry?.capped) cautions.push('The licence allows distilling or referencing only: check nothing is copied verbatim.')
    if (entry?.c4By === 'provisional') cautions.push('The executable surface (C4) was not measured from a fetched inventory.')
  } else if (kind === 'standard') {
    if (!draft.sources?.length) stricter('hold', 'The proposal cites no source for the change.')
    if (!draft.amendments?.length) stricter('hold', 'The proposal changes no rule.')
  }
  const nv = notVerified(md) || draft.notVerified || ''
  if (nv) cautions.push(`Not verified by the scout: ${nv}`)
  const agent = draft.recommendation
  if (agent && RANK[agent.verdict] !== undefined && RANK[agent.verdict] > RANK[verdict]) stricter(agent.verdict, `The scout's reviewer recommends ${agent.verdict}: ${agent.why || 'no reason given'}`)
  else if (agent?.why && agent.verdict === verdict) why.push(agent.why)
  if (verdict === 'approve' && !why.length) why.push(kind === 'source' ? `It scored ${entry?.total ?? '–'}/100 (consume ≥ 70), passes every gate and every check, and the change below is what it adds.` : 'The change is sourced, scoped to the rules below and passes every check.')
  return { verdict, why, cautions }
}
const HEADS = { approve: '✅ Recommendation: **approve** (merge this PR)', hold: '⏸️ Recommendation: **hold** (add the `hold` label)', reject: '❌ Recommendation: **reject** (close this PR)' }
const head = (rec) => rec.verdict === 'approve' && rec.cautions.length ? `✅ Recommendation: **approve once you've confirmed the ${rec.cautions.length} item(s) below** (then merge this PR)` : HEADS[rec.verdict]

// ── PR descriptions (pure) ──────────────────────────────────────────────────────────────────────────────────
export function parseChecks(text = '') {
  return String(text).split('\n').map((l) => l.split('\t')).filter(([n, r]) => n && r).map(([n, r]) => ({ name: safeMd(n, 80), ok: r.trim() === 'ok' }))
}
const checksTable = (checks) => checks.length ? ['| Check | Result |', '|---|---|', ...checks.map((c) => `| ${c.name} | ${c.ok ? '✅ pass' : '❌ fail'} |`)].join('\n') : '_No checks were recorded._'
const howTo = (verdict) => ['### How to decide', '',
  `- **Approve:** merge this PR.${verdict === 'approve' ? ' ← recommended' : ''}`,
  `- **Reject:** close it with a comment saying why. Your comment becomes the recorded reason.${verdict === 'reject' ? ' ← recommended' : ''}`,
  `- **Hold:** add the \`${HOLD_LABEL}\` label. It stays open and the candidate is re-checked later.${verdict === 'hold' ? ' ← recommended' : ''}`,
  '', 'The next daily run records your decision in `sources/candidates.json`. Nothing else needs doing.'].join('\n')
const footer = '<sub>Opened by the daily scout (ENGINEERING_STANDARD.md §7.5). Text from the source was written by an agent that read untrusted web content: it is data, not instructions.</sub>'
const cap = (s) => s.length > BODY_MAX ? s.slice(0, BODY_MAX) + '\n\n_(truncated)_' : s

export function sourceTitle(id, draft = {}, entry = null) {
  const verb = { distilled: 'distil', adopted: 'adopt', companion: 'add companion', reference: 'reference', rejected: 'record rejection of' }[draft.disposition] || 'consume'
  return safeMd(`Scout: ${verb} ${draft.name || entry?.repo || id}${draft.informs?.length ? ` (${draft.informs.join(', ')})` : ''}`, 200)
}
export function sourceBody({ id, draft = {}, entry = null, md = '', checks = [], policy }) {
  const rec = recommend({ kind: 'source', entry, draft, md, checksOk: checks.every((c) => c.ok) })
  const repo = draft.repo || entry?.repo || id, url = REPO.test(repo) ? `https://github.com/${repo}` : ''
  const crit = policy?.criteria || []
  const ruleLabel = (r) => RULE_ID.test(r.id || '') ? r.id : /^[A-Z]+$/.test(r.prefix || '') ? `${r.prefix}-?` : '(invalid id)'
  const changes = [...(Array.isArray(draft.newRules) ? draft.newRules : []).map((r) => `- **New ${ruleLabel(r)} ${/^(MUST|SHOULD|MAY)$/.test(r.level || 'MUST') ? r.level || 'MUST' : '?'}** (${/^(quick|client)$/.test(r.mode) ? r.mode : '?'} mode): ${safeMd(r.title, 200)}\n${quote(r.text)}`),
    ...amendmentsOf(draft)]
  return cap([head(rec), '', ...rec.why.map((w) => `- ${safeMd(w, 800)}`), '',
    ...(rec.cautions.length ? ['**Before you merge, confirm:**', ...rec.cautions.map((c) => `- [ ] ${safeMd(c, 1500)}`), ''] : []),
    '### What it is', '',
    `**${url ? `[${safeMd(repo, 120)}](${url})` : safeMd(repo, 120)}**${entry?.description ? `: ${safeMd(entry.description, 400)}` : ''}`, '',
    `Kind: ${safeMd(draft.kind || '–', 30)} · Licence: ${safeMd(draft.license || entry?.licence || '–', 40)}${entry?.capped ? ' (distil/reference only)' : ''} · Pinned at ${/^[0-9a-f]{40}$/.test(draft.commit || '') ? `[\`${draft.commit.slice(0, 7)}\`](${url}/tree/${draft.commit})` : '–'}${entry?.stars != null ? ` · ★${entry.stars}` : ''}`, '',
    '### What changes in the standard', '',
    `Disposition: **${safeMd(draft.disposition || '–', 30)}**. ${{ distilled: 'Ideas are written into existing rules; nothing is installed.', adopted: 'Its rules are adopted, cited to the source.', companion: 'Recommended as a companion, pinned to the reviewed commit.', reference: 'Listed as a reference only; no rule changes.' }[draft.disposition] || ''}`, '',
    ...(changes.length ? changes : ['_No rule text changes._']), '',
    ...(draft.rationale ? ['**Why this, and not something else:**', quote(draft.rationale), ''] : []),
    `### Why it scored ${entry?.total ?? '–'}/100`, '',
    entry?.why ? `${safeMd(entry.why, 1500)}\n` : '',
    crit.length ? ['| Criterion | Weight | Score (0–5) |', '|---|---|---|', ...crit.map((c) => `| ${c.id} ${c.name} | ${c.weight} | ${entry?.scores?.[c.id] ?? '–'} |`)].join('\n') : '',
    '', `Hard gates: ${entry?.gatesFailed?.length ? `❌ failed ${entry.gatesFailed.join(', ')}` : '✅ all pass (licence, not archived, alive, not brand-new, no star-farming, not a fork)'}.`, '',
    '### Checks run on this branch', '', checksTable(checks), '',
    howTo(rec.verdict), '',
    md ? `<details><summary>Full intake review (proposals/sources/${id}.md)</summary>\n\n${quote(md, 30_000)}\n\n</details>\n` : '',
    footer].join('\n'))
}
export function standardTitle(name, draft = {}) {
  return safeMd(`Scout: ${draft.title || `standards change ${name}`}${draft.amendments?.length ? ` (${draft.amendments.map((a) => a.id).join(', ')})` : ''}`, 200)
}
export function standardBody({ name, draft = {}, checks = [], policy }) {
  const rec = recommend({ kind: 'standard', draft, checksOk: checks.every((c) => c.ok) })
  const std = policy?.standards?.list?.find((s) => s.id === draft.standard)
  return cap([head(rec), '', ...rec.why.map((w) => `- ${safeMd(w, 800)}`), '',
    ...(rec.cautions.length ? ['**Before you merge, confirm:**', ...rec.cautions.map((c) => `- [ ] ${safeMd(c, 1500)}`), ''] : []),
    '### What changed upstream', '',
    `**${safeMd(std?.name || draft.standard || '–', 120)}**${std?.url ? ` (${std.url})` : ''}, noticed ${safeMd(draft.date || '–', 12)}.`, '',
    draft.summary ? quote(draft.summary) : '', '',
    ...(Array.isArray(draft.sources) && draft.sources.length ? ['Sources:', ...draft.sources.filter((u) => /^https:\/\/[\w.-]+\/[^\s<>"'`]*$/.test(u)).map((u) => `- ${safeMd(u, 300)}`), ''] : []),
    '### What changes in the standard', '',
    ...amendmentsOf(draft), '',
    '### Checks run on this branch', '', checksTable(checks), '',
    howTo(rec.verdict), '', footer].join('\n'))
}
// The rolling ledger PR: records only (scores, outcomes, intake reviews), never rule changes.
export function ledgerBody({ ledger, base = { candidates: [] }, files = [], d = today() }) {
  const before = new Map((base.candidates || []).map((c) => [c.repo.toLowerCase(), JSON.stringify(c)]))
  const changed = (ledger.candidates || []).filter((c) => before.get(c.repo.toLowerCase()) !== JSON.stringify(c))
  const row = (c) => `| ${safeMd(c.repo, 100)} | ${c.total ?? '–'} | **${c.outcome}**${c.ownerOverride ? ` (owner; matrix: ${c.ownerOverride.from})` : ''} | ${safeMd(c.why || '', 300).replace(/\|/g, '/')} |`
  const open = Object.entries(ledger.prs || {}).filter(([, p]) => ['open', 'hold'].includes(p.state))
  return cap(['✅ Recommendation: **merge** whenever convenient. This PR holds the scout\'s records only (scores, outcomes, intake reviews). It changes no rule; the proposal PRs below do that.', '',
    `### Decisions waiting for you (${open.length})`, '',
    ...(open.length ? open.map(([k, p]) => `- ${p.url ? `#${p.number}` : k}: ${safeMd(k, 100)}, recommended **${p.recommendation || '?'}**${p.state === 'hold' ? ' (on hold)' : ''}`) : ['- none']), '',
    `### Candidates changed since \`main\` (${changed.length})`, '',
    changed.length ? ['| Candidate | Score | Outcome | Why |', '|---|---|---|---|', ...changed.map(row)].join('\n') : '_None._', '',
    `### Files in this PR (${files.length})`, '', ...(files.length ? files.map((f) => `- \`${safeMd(f, 200).replace(/`/g, '')}\``) : ['- none']), '',
    `Updated ${d} by the daily scout. Rebuilt from \`origin/main\` on every run, so it never conflicts.`, '', footer].join('\n'))
}

// ── reading decisions back (pure) ───────────────────────────────────────────────────────────────────────────
// Only the repo's owner or collaborators can give the reason: the repo is public and anyone can comment.
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
export function decisionOf(pr, comments = []) {
  const n = pr.number
  if (pr.merged_at) return { state: 'merged', why: `approved: merged PR #${n}` }
  const reason = [...comments].reverse().find((c) => TRUSTED.has(c.author_association) && String(c.body || '').trim())
  const why = reason ? clean(String(reason.body).replace(/\s+/g, ' ').trim(), 600) : ''
  if (pr.state === 'closed') return { state: 'closed', why: why ? `rejected on PR #${n}: ${why}` : `rejected: PR #${n} closed without a comment` }
  if ((pr.labels || []).some((l) => l.name === HOLD_LABEL)) return { state: 'hold', why: why ? `held on PR #${n}: ${why}` : `held: PR #${n} labelled ${HOLD_LABEL}` }
  return { state: 'open', conflict: pr.mergeable === false }
}
export function applyDecision(ledger, key, dec, policy, d = today()) {
  const p = ledger.prs?.[key]; if (!p) return false
  const prevState = p.state
  if (dec.state === 'open') { p.needsRebuild = !!dec.conflict; if (prevState === 'hold') p.state = 'open' } else { p.state = dec.state; p.decided = d; p.why = dec.why; p.needsRebuild = false }
  const [kind, name] = key.split(':')
  const e = kind === 'source' ? ledger.candidates.find((c) => c.consumedAs === name) : null
  if (e) {
    if (dec.state === 'merged') { e.approved = d; e.nextReview = null; if (e.ownerOverride?.via === key) { e.outcome = e.ownerOverride.from; delete e.ownerOverride; delete e.matrixOutcome } }
    else if (dec.state === 'closed' || dec.state === 'hold') {
      const to = dec.state === 'closed' ? 'reject' : 'watch'
      if (e.outcome !== to || e.ownerOverride?.via !== key) {
        const from = e.ownerOverride?.via === key ? e.ownerOverride.from : e.outcome
        e.ownerOverride = { to, from, why: dec.why, date: d, via: key }; e.matrixOutcome = from; e.outcome = to
        e.nextReview = policy ? nextReview(to, policy, d) : null
      }
    } else if (prevState === 'hold' && e.ownerOverride?.via === key) { e.outcome = e.ownerOverride.from; delete e.ownerOverride; delete e.matrixOutcome }
  }
  return prevState !== p.state || dec.state !== 'open' || !!dec.conflict
}
// What needs a PR: consumed proposals not applied and not yet PR'd (or whose PR conflicts), and standards proposals.
export function pending(ledger, { sources = [], standards = [] } = {}) {
  const out = [], prs = ledger.prs || {}
  const want = (key) => !prs[key] || (prs[key].needsRebuild && ['open', 'hold'].includes(prs[key].state))
  for (const e of ledger.candidates || []) {
    if (e.outcome !== 'consume' || !e.consumedAs || !NAME.test(e.consumedAs)) continue
    const s = sources.find((x) => x.id === e.consumedAs); if (!s || s.applied) continue
    if (want(`source:${e.consumedAs}`)) out.push(['source', e.consumedAs])
  }
  for (const s of standards) if (NAME.test(s.name) && !s.applied && want(`standard:${s.name}`)) out.push(['standard', s.name])
  return out
}

// ── io ──────────────────────────────────────────────────────────────────────────────────────────────────────
const LEDGER = () => P('sources/candidates.json')
const loadLedger = () => readJSON(LEDGER())
const saveLedger = (l) => { l.candidates.sort((a, b) => a.repo.localeCompare(b.repo)); writeJSON(LEDGER(), l) }
const loadPolicy = () => readJSON(P('sources/scout-policy.json'))
const draftOf = (id) => { if (!NAME.test(id)) throw new Error(`bad proposal id: ${clean(id)}`); return readJSON(P('proposals/sources', `${id}.rules.json`)) }
const mdOf = (id) => existsSync(P('proposals/sources', `${id}.md`)) ? readFileSync(P('proposals/sources', `${id}.md`), 'utf8') : ''
const standardOf = (name) => { if (!NAME.test(name)) throw new Error(`bad standards proposal name: ${clean(name)}`); return readJSON(P('proposals/standards', `${name}.json`)) }
function listProposals() {
  const dir = (d) => existsSync(P(d)) ? readdirSync(P(d)) : []
  const sources = dir('proposals/sources').filter((f) => f.endsWith('.rules.json')).map((f) => { const id = f.slice(0, -11); try { return { id, applied: !!readJSON(P('proposals/sources', f)).applied } } catch { return { id, applied: true } } })
  const standards = dir('proposals/standards').filter((f) => f.endsWith('.json')).map((f) => { const name = f.slice(0, -5); try { return { name, applied: !!readJSON(P('proposals/standards', f)).applied } } catch { return { name, applied: true } } })
  return { sources, standards }
}
async function gh(path) {
  if (String(path).split(/[/?]/).some((s) => s === '.' || s === '..')) throw new Error(`refusing API path with a dot segment: ${clean(path)}`)
  const res = await fetch(`https://api.github.com/${path}`, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/vnd.github+json',
    'user-agent': 'engineering-standard-scout', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } })
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${clean(path)}`)
  return res.json()
}
async function syncCmd(repo) {
  if (!REPO.test(repo || '')) throw new Error('sync --repo owner/name')
  const ledger = loadLedger(), policy = loadPolicy(); let n = 0
  for (const [key, p] of Object.entries(ledger.prs || {})) {
    if (!['open', 'hold'].includes(p.state) || !Number.isInteger(p.number)) continue
    try {
      const pr = await gh(`repos/${repo}/pulls/${p.number}`)
      const comments = []                                     // all pages: strangers can pad a public PR with comments
      if (pr.state !== 'open' || (pr.labels || []).some((l) => l.name === HOLD_LABEL)) {
        for (let page = 1; page <= 20; page++) { const c = await gh(`repos/${repo}/issues/${p.number}/comments?per_page=100&page=${page}`); comments.push(...c); if (c.length < 100) break }
      }
      const dec = decisionOf(pr, comments)
      if (applyDecision(ledger, key, dec, policy)) { n++; console.log(`${key}: PR #${p.number} ${dec.state}${dec.conflict ? ' (conflicts with main: will be rebuilt)' : ''}${dec.why ? ` — ${dec.why}` : ''}`) }
    } catch (e) { console.log(`⚠ ${key}: ${e.message}`) }
  }
  saveLedger(ledger); console.log(`synced ${n} decision(s) from pull requests`)
}
function recordCmd(key, flags) {
  if (!/^(source|standard):[a-z0-9][a-z0-9-]{0,80}$/.test(key || '')) throw new Error('record <source|standard>:<name> --number N --url URL --branch B')
  const number = Number(flags.number); if (!Number.isInteger(number) || number < 1) throw new Error('--number must be the PR number')
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(flags.url || '')) throw new Error('--url must be the PR URL')
  if (!/^scout\/(source|standard)\/[a-z0-9-]+$/.test(flags.branch || '')) throw new Error('--branch must be scout/<kind>/<name>')
  const ledger = loadLedger(); ledger.prs ||= {}
  const prev = ledger.prs[key] || {}
  ledger.prs[key] = { ...prev, number, url: flags.url, branch: flags.branch, opened: prev.opened || today(), state: prev.state === 'hold' ? 'hold' : 'open', needsRebuild: false,
    ...(RANK[flags.rec] !== undefined ? { recommendation: flags.rec } : {}) }
  saveLedger(ledger); console.log(`${key} → PR #${number}`)
}
function run(f, ...a) { try { return { ok: true, out: execFileSync('node', [P(f), ...a], { cwd: ROOT, encoding: 'utf8' }) } } catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` } } }
function applyStandardCmd(name) {
  const draft = standardOf(name)
  if (draft.applied) throw new Error(`proposals/standards/${name}.json was already applied on ${draft.applied}`)
  const f = P('ENGINEERING_STANDARD.md'), lines = readFileSync(f, 'utf8').split('\n')
  const amended = amendLines(lines, draft.amendments || [], draft.cite ? `*(source: ${clean(draft.cite, 80)})*` : '')
  writeFileSync(f, lines.join('\n'))
  writeJSON(P('proposals/standards', `${name}.json`), { ...draft, applied: today() })
  run('bin/build-rules.mjs')
  const checks = [['build-rules --check', run('bin/build-rules.mjs', '--check')], ['similar --check', run('bin/similar.mjs', '--check')], ['check-public', run('bin/check-public.mjs')]]
  console.log(`✓ applied standards change ${name}: amended ${amended.join(' ')}`)
  for (const [n, r] of checks) console.log(`${r.ok ? '  ✓' : '  ✗'} ${n}\n${r.out.trim().split('\n').map((l) => '    ' + l).join('\n')}`)
  return checks.every(([, r]) => r.ok)
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2), flags = {}, pos = []
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i]; else pos.push(argv[i]) }
  const [cmd, a, b] = pos
  const checks = flags.checks ? parseChecks(existsSync(flags.checks) ? readFileSync(flags.checks, 'utf8') : '') : []
  const entryFor = (id) => loadLedger().candidates.find((c) => c.consumedAs === id) || null
  try {
    if (cmd === 'pending') for (const [k, n] of pending(loadLedger(), listProposals())) console.log(`${k} ${n}`)
    else if (cmd === 'title' && a === 'source') console.log(sourceTitle(b, draftOf(b), entryFor(b)))
    else if (cmd === 'title' && a === 'standard') console.log(standardTitle(b, standardOf(b)))
    else if (cmd === 'body' && a === 'source') console.log(sourceBody({ id: b, draft: draftOf(b), entry: entryFor(b), md: mdOf(b), checks, policy: loadPolicy() }))
    else if (cmd === 'body' && a === 'standard') console.log(standardBody({ name: b, draft: standardOf(b), checks, policy: loadPolicy() }))
    else if (cmd === 'body' && a === 'ledger') console.log(ledgerBody({ ledger: loadLedger(), base: flags.base && existsSync(flags.base) ? readJSON(flags.base) : { candidates: [] }, files: (flags.files || '').split(',').filter(Boolean) }))
    else if (cmd === 'recommend' && (a === 'source' || a === 'standard')) {
      const r = a === 'source' ? recommend({ kind: a, entry: entryFor(b), draft: draftOf(b), md: mdOf(b), checksOk: checks.every((c) => c.ok) }) : recommend({ kind: a, draft: standardOf(b), checksOk: checks.every((c) => c.ok) })
      console.log(r.verdict)
    }
    else if (cmd === 'apply-standard' && a) { if (!applyStandardCmd(a)) process.exit(1) }
    else if (cmd === 'record') recordCmd(a, flags)
    else if (cmd === 'sync') await syncCmd(flags.repo)
    else { console.error('see the header of bin/scout-pr.mjs for usage'); process.exit(2) }
  } catch (e) { console.error(`✗ ${e.message}`); process.exit(1) }
}

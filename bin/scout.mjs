#!/usr/bin/env node
// Daily scouting for the sources gateway (AGT-5): find new security tools, skills, plugins and standards changes,
// decide with one decision matrix (sources/scout-policy.json), remember every decision (sources/candidates.json)
// so each day only looks at what is new or changed. Zero deps. The judgement calls (gap fit, novelty) are the
// agent's — /engineering-standard:scout drives the daily run; this script does the repeatable, mechanical parts.
//
//   node bin/scout.mjs due                         what today's run must look at: re-checks due, unjudged candidates,
//                                                  standards due a check (drift: node bin/sources.mjs --upstream)
//   node bin/scout.mjs discover [--since DATE]     (network) policy searches + watched orgs → repos new to the ledger
//   node bin/scout.mjs score <url|owner/repo>…     (network) hard gates G1–G6 + mechanical criteria C1–C4 → ledger
//   node bin/scout.mjs judge <owner/repo> --fit N --novelty N --why "…" [--gap ID,ID] [--surface N]
//                                                  the agent's C5/C6 → total, outcome, next review date
//   node bin/scout.mjs consumed <owner/repo> --as <source-id>    link a candidate to its /consume proposal
//   node bin/scout.mjs standard <id> --note "…"    record that a cited standard was checked today
//   node bin/scout.mjs report [--email [--if-changed]]   today's run as Markdown (saved to local/scout/), or --email:
//                                                  subject + plain-text summary for the owner's inbox (--if-changed:
//                                                  exit 3 and print nothing when nothing changed today)
//   node bin/scout.mjs --check | --render          validate policy + ledger + README table (CI) | regenerate the table
import { readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { clean } from './consume.mjs'

const ROOT = process.env.STANDARD_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => join(ROOT, ...a)
const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'))
const writeJSON = (f, o) => writeFileSync(f, JSON.stringify(o, null, 2) + '\n')
export const today = () => process.env.SCOUT_TODAY || new Date().toISOString().slice(0, 10)
const DAY = 86_400_000
const days = (from, to = today()) => Math.floor((Date.parse(to) - Date.parse(String(from).slice(0, 10))) / DAY)
const addDays = (d, n) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10)
export const loadPolicy = () => readJSON(P('sources/scout-policy.json'))
const LEDGER = () => P('sources/candidates.json')
export const loadLedger = () => existsSync(LEDGER()) ? readJSON(LEDGER()) : { candidates: [], standards: {} }
const saveLedger = (l) => { l.candidates.sort((a, b) => a.repo.localeCompare(b.repo)); writeJSON(LEDGER(), l) }
const REPO = /^(?!\.{1,2}\/)[\w.-]+\/(?!\.{1,2}$)[\w.-]+$/

// ── the decision matrix (pure; tested offline) ───────────────────────────────────────────────────────────────
export function licenceClass(spdx, policy) {
  const id = String(spdx || 'NOASSERTION'), L = policy.licences
  return L.allow.includes(id) ? 'allow' : L.conditional.includes(id) ? 'conditional' : 'deny'
}
const vendor = (owner, policy) => policy.trustedVendors.map((v) => v.toLowerCase()).includes(String(owner).toLowerCase())

// meta: { owner, ownerType, licence, archived, disabled, fork, createdAt, pushedAt, stars }
export function gates(meta, policy, now = today()) {
  const g = Object.fromEntries(policy.gates.map((x) => [x.id, x])), trusted = vendor(meta.owner, policy)
  const lc = licenceClass(meta.licence, policy), age = days(meta.createdAt, now)
  const out = [
    { id: 'G1', pass: lc !== 'deny', why: `licence ${meta.licence || 'none'} → ${lc}` },
    { id: 'G2', pass: !meta.archived && !meta.disabled, why: meta.archived ? 'archived' : meta.disabled ? 'disabled' : 'active' },
    { id: 'G3', pass: days(meta.pushedAt, now) <= g.G3.maxIdleDays, why: `last push ${days(meta.pushedAt, now)}d ago` },
    { id: 'G4', pass: trusted || age >= g.G4.minAgeDays, why: `${age}d old${trusted ? ', trusted vendor' : ''}` },
    { id: 'G5', pass: trusted || age >= 180 || meta.stars / Math.max(age, 1) <= g.G5.maxStarsPerDay,
      why: `${(meta.stars / Math.max(age, 1)).toFixed(1)} stars/day${trusted && age < 180 && meta.stars / Math.max(age, 1) > g.G5.maxStarsPerDay ? ' — over the limit, vendor-exempt: verify the vendor really publishes it' : ''}` },
    { id: 'G6', pass: !meta.fork, why: meta.fork ? 'fork — review the upstream' : 'original' },
  ]
  return { results: out, failed: out.filter((r) => !r.pass).map((r) => r.id), capped: lc === 'conditional' }
}

// extra: { verified, ownerAgeDays, ownerRepos, contributors, releases, inventory }
export function mechanical(meta, extra, policy, now = today()) {
  const C1 = vendor(meta.owner, policy) ? 5 : meta.ownerType === 'Organization' ? (extra.verified ? 4 : 3)
    : (extra.ownerAgeDays >= 730 && extra.ownerRepos >= 10 ? 2 : 1)
  const idle = days(meta.pushedAt, now)
  const recency = idle <= 30 ? 5 : idle <= 90 ? 4 : idle <= 180 ? 3 : idle <= 365 ? 1 : 0
  const C2 = round((recency + (extra.releases > 0 ? 5 : 1) + (extra.contributors >= 10 ? 5 : extra.contributors >= 3 ? 3 : 1)) / 3)
  const C3 = round(Math.min(5, Math.max(0, Math.log10(Math.max(meta.stars, 1)) * 1.25)))
  let C4 = 3                                                       // unknown until /consume fetch inventories it
  const inv = extra.inventory
  if (inv) {
    const s = inv.signals || {}, h = inv.hidden || {}
    C4 = 5 - [s.hooks === 'present', s.injectsEveryPrompt === true || s.injectsIntoSubagents === true, (h.installScripts || []).length > 0,
      (h.codeNetworkHosts || []).length > 0, (h.loadTimeCommands || []).length > 0 || (h.remoteInstructionHosts || []).length > 0].filter(Boolean).length
    C4 = Math.max(0, C4)
  }
  return { C1, C2, C3, C4 }
}
const round = (x) => Math.round(x * 10) / 10

export function total(scores, policy) {
  let sum = 0, w = 0
  for (const c of policy.criteria) if (typeof scores[c.id] === 'number') { sum += (scores[c.id] / 5) * c.weight; w += c.weight }
  return w === 100 ? Math.round(sum) : null                      // incomplete until the agent judges C5/C6
}
export function outcome(t, failed, policy) {
  if (failed.length) return 'reject'
  if (t == null) return 'pending-judgement'
  return [...policy.outcomes].sort((a, b) => b.min - a.min).find((o) => t >= o.min).id
}
export function nextReview(oc, policy, now = today()) {
  const o = policy.outcomes.find((x) => x.id === oc)
  return o && o.recheckDays ? addDays(now, o.recheckDays) : null
}
// A candidate needs looking at again when its re-check date has come, or upstream moved since we scored it.
export function isDue(entry, now = today(), pushedAt = null) {
  if (entry.outcome === 'pending-judgement') return 'needs judgement'
  if (entry.outcome === 'consume' && !entry.consumedAs) return 'needs /consume'
  if (entry.nextReview && entry.nextReview <= now) return 're-check date reached'
  if (pushedAt && entry.pushedAt && pushedAt > entry.pushedAt && entry.outcome === 'watch') return 'changed upstream'
  return null
}
export function standardsDue(policy, ledger, now = today()) {
  return policy.standards.list.filter((s) => {
    const last = ledger.standards?.[s.id]?.checked, every = policy.standards.checkEvery[s.kind] ?? policy.standards.checkEvery.default
    return !last || days(last, now) >= every
  })
}

// ── GitHub (network) ─────────────────────────────────────────────────────────────────────────────────────────
async function ghRaw(path) {
  if (String(path).split(/[/?]/).some((s) => s === '.' || s === '..' || /%2e/i.test(s))) throw new Error(`refusing API path with a dot segment: ${clean(path)}`)
  const res = await fetch(`https://api.github.com/${path}`, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/vnd.github+json',
    'user-agent': 'engineering-standard-scout', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } })
  if (!res.ok) { const e = new Error(`GitHub ${res.status} for ${clean(path)}${res.status === 403 ? ' (rate limit? set GITHUB_TOKEN=$(gh auth token))' : ''}`); e.status = res.status; throw e }
  return res
}
const gh = async (path) => (await ghRaw(path)).json()
async function countOf(path) {                                    // total items via the Link header's last page
  const res = await ghRaw(`${path}${path.includes('?') ? '&' : '?'}per_page=1`), body = await res.json()
  const last = (res.headers.get('link') || '').match(/[?&]page=(\d+)>; rel="last"/)
  return last ? Number(last[1]) : Array.isArray(body) ? body.length : 0
}
// owner/repo segments: GitHub's own charset, never "." or ".." (an authenticated API path must not be steered to
// another endpoint — the token is attached to every call).
const SEG = /^(?!\.{1,2}$)[\w.-]{1,100}$/
export const toRepo = (s) => {
  const m = String(s).trim().replace(/\.git$/, '').match(/^(?:https?:\/\/github\.com\/)?([^/\s]+)\/([^/\s#?]+)/)
  if (!m || !SEG.test(m[1]) || !SEG.test(m[2])) throw new Error(`not a GitHub repo: ${clean(s)}`)
  return `${m[1]}/${m[2]}`
}

// GitHub says NOASSERTION when a standard licence file has an extra header or notice. Recognise the canonical
// texts so a real Apache/MIT/BSD/GPL repo isn't rejected; anything else stays NOASSERTION (denied by G1).
export function licenceFromText(text) {
  const t = String(text || '').replace(/\s+/g, ' ')
  if (/Apache License,? Version 2\.0/i.test(t) && /TERMS AND CONDITIONS FOR USE/i.test(t)) return 'Apache-2.0'
  if (/Licensed under the Apache License,? Version 2\.0 \(the "License"\)/i.test(t) && !/Commons Clause|non-?commercial/i.test(t)) return 'Apache-2.0'   // the standard short notice
  if (/Permission is hereby granted, free of charge, to any person obtaining a copy/i.test(t) && !/non-?commercial|Commons Clause/i.test(t)) return 'MIT'
  if (/GNU GENERAL PUBLIC LICENSE Version 3/i.test(t) && !/AFFERO/i.test(t)) return 'GPL-3.0'
  if (/Redistribution and use in source and binary forms/i.test(t) && /Neither the name/i.test(t)) return 'BSD-3-Clause'
  return null
}
async function collect(full) {
  const r = await gh(`repos/${full}`), owner = r.owner.login
  let licence = r.license?.spdx_id || 'NOASSERTION', licenceSource = 'GitHub'
  if (licence === 'NOASSERTION' || licence === 'NONE') {
    try { const l = await gh(`repos/${full}/license`), found = licenceFromText(Buffer.from(l.content || '', 'base64').toString('utf8'))
      if (found) { licence = found; licenceSource = `${clean(l.path, 60)} text (GitHub: NOASSERTION)` } } catch {}
  }
  const meta = { owner: clean(owner, 60), ownerType: r.owner.type, licence: clean(licence, 40), licenceSource, archived: !!r.archived,
    disabled: !!r.disabled, fork: !!r.fork, createdAt: r.created_at, pushedAt: r.pushed_at, stars: r.stargazers_count, description: clean(r.description, 200) }
  const extra = { verified: false, ownerAgeDays: 0, ownerRepos: 0, contributors: 0, releases: 0, inventory: null }
  try { const o = await gh(r.owner.type === 'Organization' ? `orgs/${owner}` : `users/${owner}`)
    extra.verified = !!o.is_verified; extra.ownerAgeDays = days(o.created_at); extra.ownerRepos = o.public_repos || 0 } catch {}
  try { extra.contributors = await countOf(`repos/${full}/contributors?anon=1`) } catch {}
  try { extra.releases = (await countOf(`repos/${full}/releases`)) || (await countOf(`repos/${full}/tags`)) } catch {}
  extra.inventory = inventoryFor(r.full_name)
  return { meta, extra, full: r.full_name }
}
function inventoryFor(full) {                                     // a /consume fetch of this repo, if one exists locally
  const dir = P('local/consume'); if (!existsSync(dir)) return null
  for (const id of readdirSync(dir)) { try { const inv = readJSON(join(dir, id, 'inventory.json')); if (inv.repo?.toLowerCase() === full.toLowerCase()) return inv } catch {} }
  return null
}

// ── commands ─────────────────────────────────────────────────────────────────────────────────────────────────
function upsert(ledger, repo) {
  let e = ledger.candidates.find((c) => c.repo.toLowerCase() === repo.toLowerCase())
  if (!e) { e = { repo, url: `https://github.com/${repo}`, firstSeen: today(), scores: {} }; ledger.candidates.push(e) }
  return e
}
async function scoreCmd(args) {
  const policy = loadPolicy(), ledger = loadLedger()
  const registry = new Set(readJSON(P('sources/registry.json')).sources.map((s) => s.repo.toLowerCase()))
  const repos = args.map(toRepo).slice(0, policy.budget.maxScored)
  if (args.length > repos.length) console.log(`(budget: scoring ${repos.length} of ${args.length}; the rest wait for the next run)`)
  for (const repo of repos) {
    try {
      const { meta, extra, full } = await collect(repo)
      const g = gates(meta, policy), m = mechanical(meta, extra, policy), e = upsert(ledger, full)
      const warn = g.results.filter((r) => r.pass && /over the limit/.test(r.why)).map((r) => `${r.id}: ${r.why}`)
      if (warn.length) console.log(`  ⚠ ${full}: ${warn.join('; ')}`)
      Object.assign(e, { description: meta.description, licence: meta.licence, licenceSource: meta.licenceSource, licenceClass: licenceClass(meta.licence, policy), stars: meta.stars, warnings: warn.length ? warn : undefined,
        pushedAt: meta.pushedAt, lastScored: today(), gatesFailed: g.failed, capped: g.capped, inRegistry: registry.has(full.toLowerCase()) })
      const keepAgentC4 = e.c4By === 'agent' && !extra.inventory  // an inventory always wins; otherwise keep the agent's documented C4
      e.scores = { ...e.scores, ...m, ...(keepAgentC4 ? { C4: e.scores.C4 } : {}) }
      e.c4By = extra.inventory ? 'inventory' : keepAgentC4 ? 'agent' : 'provisional'
      e.total = total(e.scores, policy); e.outcome = outcome(e.total, g.failed, policy); e.nextReview = nextReview(e.outcome, policy)
      if (g.failed.length) e.why = g.results.filter((r) => !r.pass).map((r) => `${r.id}: ${r.why}`).join('; ')
      console.log(`${g.failed.length ? '✗' : '✓'} ${full}  ${meta.licence}${g.capped ? ' (distil/reference only)' : ''} · ★${meta.stars} · ${g.results.map((r) => `${r.id}${r.pass ? '' : '✗'}`).join(' ')}`
        + ` · C1 ${m.C1} C2 ${m.C2} C3 ${m.C3} C4 ${m.C4}${extra.inventory ? '' : ' (C4 provisional)'} → ${e.outcome}${e.total != null ? ` ${e.total}` : ''}`)
      if (g.failed.length) console.log(`    ${e.why}`)
    } catch (err) { console.log(`⚠ ${repo}: ${err.message}`) }
  }
  ledger.queue = mergeQueue(ledger.queue, [], policy, new Set(ledger.candidates.map((c) => c.repo.toLowerCase())))
  saveLedger(ledger)
}
function judgeCmd(repo, flags) {
  const policy = loadPolicy(), ledger = loadLedger(), e = ledger.candidates.find((c) => c.repo.toLowerCase() === toRepo(repo).toLowerCase())
  if (!e) throw new Error(`${clean(repo)} is not in the ledger — run: node bin/scout.mjs score ${clean(repo)}`)
  const fit = Number(flags.fit), nov = Number(flags.novelty)
  if (![fit, nov].every((n) => Number.isFinite(n) && n >= 0 && n <= 5)) throw new Error('--fit and --novelty must be numbers 0–5')
  if (!flags.why || flags.why.length < 20) throw new Error('--why is required (≥ 20 chars): what gap it fills or why not')
  e.scores = { ...e.scores, C5: fit, C6: nov }; e.why = clean(flags.why, 600); e.judged = today()
  if (flags.surface !== undefined) {                              // documented surface (README says: token, remote analysis …) before any fetch
    const s = Number(flags.surface); if (!(s >= 0 && s <= 5)) throw new Error('--surface must be 0–5')
    if (e.c4By === 'inventory' && s > e.scores.C4) throw new Error('--surface cannot raise a C4 measured from a /consume inventory')
    e.scores.C4 = s; e.c4By = 'agent'
  }
  if (flags.gap) e.gap = flags.gap.split(',').map((s) => s.trim()).filter(Boolean)
  e.total = total(e.scores, policy); e.outcome = outcome(e.total, e.gatesFailed || [], policy); e.nextReview = nextReview(e.outcome, policy)
  saveLedger(ledger)
  console.log(`${e.repo}: ${e.total}/100 → ${e.outcome}${e.capped ? ' (licence: distil/reference only)' : ''}${e.nextReview ? ` · re-check ${e.nextReview}` : ''}`)
}
function consumedCmd(repo, id) {
  const ledger = loadLedger(), e = ledger.candidates.find((c) => c.repo.toLowerCase() === toRepo(repo).toLowerCase())
  if (!e) throw new Error(`${clean(repo)} is not in the ledger`)
  if (!/^[a-z0-9-]+$/.test(id || '')) throw new Error('--as <source-id> (kebab-case, as in proposals/sources/<id>.md)')
  e.consumedAs = id; e.nextReview = null; saveLedger(ledger); console.log(`${e.repo} → proposals/sources/${id}.md`)
}
function standardCmd(id, note) {
  const policy = loadPolicy(), ledger = loadLedger()
  if (!policy.standards.list.some((s) => s.id === id)) throw new Error(`unknown standard "${clean(id)}" — ids: ${policy.standards.list.map((s) => s.id).join(', ')}`)
  ledger.standards = { ...ledger.standards, [id]: { checked: today(), note: clean(note || 'no change', 400) } }; saveLedger(ledger)
  console.log(`${id} checked ${today()}`)
}
function dueCmd() {
  const policy = loadPolicy(), ledger = loadLedger()
  const cands = ledger.candidates.map((e) => [e, isDue(e)]).filter(([, why]) => why)
  const std = standardsDue(policy, ledger)
  console.log(`# Scout — due ${today()}\n`)
  console.log(`Budget: score ≤ ${policy.budget.maxScored} · judge ≤ ${policy.budget.maxJudged} · consume ≤ ${policy.budget.maxConsumed} · drift reviews ≤ ${policy.budget.maxDriftReviews}`)
  console.log(`Last discover: ${ledger.lastDiscover || 'never'} — run \`node bin/scout.mjs discover\`; drift: \`node bin/sources.mjs --upstream\`\n`)
  console.log(`## Candidates (${cands.length})`)
  for (const [e, why] of cands.sort((a, b) => (b[0].total ?? -1) - (a[0].total ?? -1))) console.log(`- ${e.repo} — ${why} (${e.outcome}${e.total != null ? ` ${e.total}` : ''})`)
  const q = mergeQueue(ledger.queue, [], policy, new Set(ledger.candidates.map((c) => c.repo.toLowerCase())))
  console.log(`\n## Discovered, not yet scored (${q.length}) — triage before running discover again`)
  for (const x of q.slice(0, 15)) console.log(`- ${x.repo} ★${x.stars} ${x.licence} — ${x.desc} (found ${x.found})`)
  console.log(`\n## Standards to check (${std.length})`)
  for (const s of std) console.log(`- ${s.id} — ${s.name} (cited ${s.cited}; last ${ledger.standards?.[s.id]?.checked || 'never'}) ${s.url}`)
}
async function discoverCmd(flags) {
  const policy = loadPolicy(), ledger = loadLedger()
  const since = flags.since || ledger.lastDiscover || addDays(today(), -30)
  const known = new Set([...readJSON(P('sources/registry.json')).sources.map((s) => s.repo), ...ledger.candidates.map((c) => c.repo)].map((r) => r.toLowerCase()))
  const found = new Map()
  const add = (r, via) => { if (!r || r.fork || r.archived || known.has(r.full_name.toLowerCase())) return
    const x = found.get(r.full_name) || { repo: r.full_name, stars: r.stargazers_count, licence: r.license?.spdx_id || 'NOASSERTION', desc: clean(r.description, 120), via: [] }
    x.via.push(via); found.set(r.full_name, x) }
  for (const q of policy.discovery.queries) {
    try { const res = await gh(`search/repositories?q=${encodeURIComponent(`${q} pushed:>=${since}`)}&sort=stars&order=desc&per_page=20`); for (const r of res.items || []) add(r, `search: ${q}`) }
    catch (e) { console.log(`⚠ search "${q}": ${e.message}`) }
  }
  for (const org of policy.discovery.watchOrgs) {
    try { for (const r of await gh(`orgs/${org}/repos?sort=created&direction=desc&per_page=15`)) if (r.created_at.slice(0, 10) >= since) add(r, `new in ${org}`) }
    catch (e) { console.log(`⚠ org ${org}: ${e.message}`) }
  }
  const list = [...found.values()].sort((a, b) => (b.via.length - a.via.length) || (b.stars - a.stars))
  console.log(`# Discovered since ${since}: ${list.length} repo(s) new to the ledger and registry\n`)
  for (const x of list.slice(0, 40)) console.log(`- ${clean(x.repo, 100)} ★${x.stars} ${clean(x.licence, 40)} — ${x.desc} [${x.via.slice(0, 2).map((v) => clean(v, 60)).join('; ')}]`)
  console.log(`\nTriage: pick the ones relevant to the standard and run \`node bin/scout.mjs score <repo>…\` (≤ ${policy.budget.maxScored}).`)
  ledger.queue = mergeQueue(ledger.queue, list.map((x) => ({ repo: clean(x.repo, 100), stars: x.stars, licence: clean(x.licence, 40), desc: x.desc, found: today(), hits: x.via.length })), policy)
  ledger.lastDiscover = today(); saveLedger(ledger)
}
// Discovered but not yet scored: kept (best first, capped) so tomorrow's run doesn't lose today's overflow; dropped
// once scored or after queueDays (a repo that matters will be found again).
export function mergeQueue(queue = [], found = [], policy, scored = new Set(), now = today()) {
  const byRepo = new Map()
  for (const q of [...queue, ...found]) { const k = q.repo.toLowerCase(); if (scored.has(k) || days(q.found, now) > (policy.discovery.queueDays ?? 30)) continue
    const prev = byRepo.get(k); byRepo.set(k, prev ? { ...q, found: prev.found, hits: Math.max(prev.hits || 1, q.hits || 1) } : q) }
  return [...byRepo.values()].sort((a, b) => (b.hits - a.hits) || (b.stars - a.stars)).slice(0, policy.discovery.queueMax ?? 40)
}
// Plain-text summary for the owner's inbox: only what changed today and what needs their decision.
export function emailSummary(ledger, policy, d = today()) {
  const touched = ledger.candidates.filter((c) => c.lastScored === d || c.judged === d)
  const by = (o) => touched.filter((c) => c.outcome === o)
  const line = (c) => `  - ${c.repo} (${c.licence}${c.capped ? ', distil/reference only' : ''}) — ${c.total ?? '–'}/100${c.consumedAs ? ` → proposals/sources/${c.consumedAs}.md` : ''}: ${c.why || ''}`
  const std = Object.entries(ledger.standards || {}).filter(([, v]) => v.checked === d && !/^no change/i.test(v.note))
  const decide = by('consume').length + std.length
  const subject = `[engineering-standard] Scout ${d}: ${by('consume').length} to approve, ${by('watch').length} watching, ${by('reject').length} rejected${std.length ? `, ${std.length} standard update(s)` : ''}`
  const body = [`Daily scout — ${d}`, '',
    `Needs your approval (${by('consume').length}) — proposals written, nothing applied or committed:`, ...(by('consume').map(line).length ? by('consume').map(line) : ['  - none']), '',
    `Standards that changed (${std.length}):`, ...(std.length ? std.map(([k, v]) => `  - ${k}: ${v.note}`) : ['  - none']), '',
    `Watching (${by('watch').length}):`, ...(by('watch').map(line).length ? by('watch').map(line) : ['  - none']), '',
    `Rejected (${by('reject').length}):`, ...(by('reject').map(line).length ? by('reject').map(line) : ['  - none']), '',
    `Matrix: gates ${policy.gates.map((g) => g.id).join('/')} · weights ${policy.criteria.map((c) => `${c.id} ${c.weight}`).join(', ')} · consume ≥ ${policy.outcomes.find((o) => o.id === 'consume').min}.`,
    decide ? 'Reply or open the scout branch to approve; /engineering-standard:consume applies only after you say yes.' : 'Nothing needs a decision today.'].join('\n')
  return { subject, body, needsDecision: decide > 0, changed: touched.length + std.length > 0 }
}
function reportCmd(flags = {}) {
  const policy = loadPolicy(), ledger = loadLedger(), d = today()
  if (flags.email) {
    const e = emailSummary(ledger, policy, d)
    if (flags['if-changed'] && !e.changed) process.exit(3)         // the scheduler sends nothing on a quiet day
    console.log(`Subject: ${e.subject}\n\n${e.body}`); return
  }
  const touched = ledger.candidates.filter((c) => c.lastScored === d || c.judged === d)
  const row = (c) => `| [${c.repo}](${c.url}) | ${c.licence}${c.capped ? ' ⚠' : ''} | ${c.gatesFailed?.length ? c.gatesFailed.join(' ') : '✓'} | ${['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((k) => c.scores?.[k] ?? '–').join(' · ')} | ${c.total ?? '–'} | **${c.outcome}**${c.consumedAs ? ` → ${c.consumedAs}` : ''} | ${(c.why || '').replace(/\|/g, '/')} |`
  console.log(`# Scout report — ${d}\n\n| Candidate | Licence | Gates | C1 · C2 · C3 · C4 · C5 · C6 | Score | Outcome | Why |\n|---|---|---|---|---|---|---|\n${touched.map(row).join('\n') || '| — | | | | | | |'}`)
  const std = Object.entries(ledger.standards || {}).filter(([, v]) => v.checked === d)
  console.log(`\n## Standards checked today\n${std.map(([k, v]) => `- ${k}: ${v.note}`).join('\n') || '- none'}`)
  console.log(`\n_Weights: ${policy.criteria.map((c) => `${c.id} ${c.weight}`).join(' · ')}. Outcomes: ${policy.outcomes.map((o) => `${o.id} ≥ ${o.min}`).join(', ')}._`)
}

// ── check / render ───────────────────────────────────────────────────────────────────────────────────────────
export function renderMatrix(policy = loadPolicy()) {
  return ['**Hard gates** — any failure rejects the candidate:', '', '| Gate | Passes when |', '|---|---|',
    ...policy.gates.map((g) => `| ${g.id} ${g.name} | ${g.test} |`), '',
    '**Weighted criteria** (each 0–5) → score out of 100:', '', '| Criterion | Weight | Scored by | 5 … 0 |', '|---|---|---|---|',
    ...policy.criteria.map((c) => `| ${c.id} ${c.name} | ${c.weight} | ${c.by} | ${c.how} |`), '',
    '| Outcome | Score | Action |', '|---|---|---|',
    ...[...policy.outcomes].sort((a, b) => b.min - a.min).map((o) => `| **${o.id}** | ≥ ${o.min} | ${o.action} |`), '',
    `Licences (SPDX): **allow** ${policy.licences.allow.join(', ')} · **conditional — distil/reference only** ${policy.licences.conditional.join(', ')} · anything else, including no licence, is **denied**.`,
    `Daily budget: score ≤ ${policy.budget.maxScored}, judge ≤ ${policy.budget.maxJudged}, consume ≤ ${policy.budget.maxConsumed}, drift re-reviews ≤ ${policy.budget.maxDriftReviews}.`].join('\n')
}
const MARK = /(<!-- scout-matrix:begin[^>]*-->\n)[\s\S]*?(<!-- scout-matrix:end -->)/
export function render({ write = true } = {}) {
  const f = P('README.md'), text = readFileSync(f, 'utf8')
  if (!MARK.test(text)) return ['README.md: missing <!-- scout-matrix:begin/end --> markers']
  const next = text.replace(MARK, `$1${renderMatrix()}\n$2`)
  if (next === text) return []
  if (write) writeFileSync(f, next)
  return ['README.md: scout matrix is stale — run node bin/scout.mjs --render']
}
export function check(policy = loadPolicy(), ledger = loadLedger()) {
  const errors = [], w = policy.criteria.reduce((s, c) => s + c.weight, 0)
  if (w !== 100) errors.push(`scout-policy: criteria weights sum to ${w}, must be 100`)
  if (!policy.outcomes.some((o) => o.min === 0)) errors.push('scout-policy: one outcome must have min 0')
  const overlap = policy.licences.allow.filter((l) => policy.licences.conditional.includes(l) || policy.licences.deny.includes(l))
  if (overlap.length) errors.push(`scout-policy: licence in more than one list: ${overlap.join(', ')}`)
  const outs = new Set([...policy.outcomes.map((o) => o.id), 'pending-judgement']), seen = new Set()
  for (const c of ledger.candidates || []) {
    const at = `candidates.json "${c.repo}"`
    if (!REPO.test(c.repo || '')) errors.push(`${at}: repo must be owner/name`)
    if (seen.has(String(c.repo).toLowerCase())) errors.push(`${at}: duplicate`); seen.add(String(c.repo).toLowerCase())
    if (!outs.has(c.outcome)) errors.push(`${at}: outcome must be one of ${[...outs].join('|')}`)
    if (c.outcome === 'reject' && !c.why) errors.push(`${at}: a rejection needs a why`)
    if (c.consumedAs && !existsSync(P('proposals/sources', `${c.consumedAs}.md`))) errors.push(`${at}: consumedAs ${c.consumedAs} has no proposals/sources/${c.consumedAs}.md`)
  }
  for (const id of Object.keys(ledger.standards || {})) if (!policy.standards.list.some((s) => s.id === id)) errors.push(`candidates.json: unknown standard "${id}"`)
  return errors
}

// ── cli ──────────────────────────────────────────────────────────────────────────────────────────────────────
function flagsOf(argv) {
  const pos = [], flags = {}
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { const k = argv[i].slice(2); flags[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true } else pos.push(argv[i]) }
  return { pos, flags }
}
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const [cmd, ...rest] = process.argv.slice(2), { pos, flags } = flagsOf(rest)
  try {
    if (cmd === '--render') { const c = render(); console.log(c.length ? 'rendered the scout matrix' : 'scout matrix already current') }
    else if (cmd === '--check' || !cmd) { const errors = [...check(), ...render({ write: false })]; for (const e of errors) console.error(`✗ ${e}`)
      console.log(`scout: ${loadLedger().candidates.length} candidate(s), ${errors.length} error(s)`); process.exit(errors.length ? 1 : 0) }
    else if (cmd === 'due') dueCmd()
    else if (cmd === 'discover') await discoverCmd(flags)
    else if (cmd === 'score') { if (!pos.length) throw new Error('score <url|owner/repo>…'); await scoreCmd(pos) }
    else if (cmd === 'judge') judgeCmd(pos[0], flags)
    else if (cmd === 'consumed') consumedCmd(pos[0], flags.as)
    else if (cmd === 'standard') standardCmd(pos[0], flags.note)
    else if (cmd === 'report') reportCmd(flags)
    else throw new Error(`unknown command "${clean(cmd)}" — see the header of bin/scout.mjs`)
  } catch (e) { console.error(`✗ ${e.message}`); process.exit(1) }
}

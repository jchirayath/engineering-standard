#!/usr/bin/env node
// External sources gateway (AGT-5): every third-party skill, plugin, prompt or rule set that informs this
// standard is recorded in sources/registry.json, pinned to a reviewed commit. Zero deps.
//   node bin/sources.mjs --check       validate the registry (CI): schema, pins, rule IDs, proposal files
//   node bin/sources.mjs --upstream    (network) compare each pin with upstream HEAD for its watched paths;
//                                      prints a Markdown report, exit 1 when any watched path changed
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REG = join(ROOT, 'sources/registry.json')
const DISPOSITIONS = ['proposed', 'distilled', 'companion', 'reference', 'rejected']
const KINDS = ['skill', 'plugin', 'prompt', 'rules', 'tool']

export function check() {
  const errors = [], reg = JSON.parse(readFileSync(REG, 'utf8'))
  const rules = new Set(JSON.parse(readFileSync(join(ROOT, 'build/rules.json'), 'utf8')).rules.map((r) => r.id))
  const seen = new Set()
  for (const s of reg.sources || []) {
    const at = `sources/registry.json "${s.id || '?'}"`
    if (!/^[a-z0-9-]+$/.test(s.id || '')) errors.push(`${at}: id must be kebab-case`)
    if (seen.has(s.id)) errors.push(`${at}: duplicate id`); seen.add(s.id)
    if (!/^[\w.-]+\/[\w.-]+$/.test(s.repo || '')) errors.push(`${at}: repo must be owner/name`)
    if (!/^[0-9a-f]{40}$/.test(s.commit || '')) errors.push(`${at}: commit must be a full 40-char SHA (pin, AGT-5)`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.reviewed || '')) errors.push(`${at}: reviewed must be an ISO date`)
    if (!s.license) errors.push(`${at}: license is required (REPO-4)`)
    if (!KINDS.includes(s.kind)) errors.push(`${at}: kind must be one of ${KINDS.join('|')}`)
    if (!DISPOSITIONS.includes(s.disposition)) errors.push(`${at}: disposition must be one of ${DISPOSITIONS.join('|')}`)
    if (!Array.isArray(s.paths) || !s.paths.length) errors.push(`${at}: paths (the files whose change triggers re-review) are required`)
    for (const id of s.informs || []) if (!rules.has(id)) errors.push(`${at}: informs ${id}, which is not a defined rule`)
    if (['distilled', 'companion'].includes(s.disposition) && !(s.informs || []).length) errors.push(`${at}: a ${s.disposition} source must list the rules it informs`)
    if (s.disposition === 'companion' && !(s.companion?.install && s.companion?.precedence)) errors.push(`${at}: companion needs companion.install and companion.precedence`)
    if (!existsSync(join(ROOT, 'proposals/sources', `${s.id}.md`))) errors.push(`${at}: missing proposals/sources/${s.id}.md (the intake review)`)
  }
  return { errors, count: (reg.sources || []).length }
}

async function gh(path) {
  const res = await fetch(`https://api.github.com/${path}`, { signal: AbortSignal.timeout(15000),
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'engineering-standard', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } })
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`)
  return res.json()
}
const watched = (file, paths) => paths.some((p) => p.endsWith('/') ? file.startsWith(p) : file === p)

async function upstream() {
  const reg = JSON.parse(readFileSync(REG, 'utf8')), rows = []; let drift = 0
  for (const s of (reg.sources || []).filter((x) => x.disposition !== 'rejected')) {
    try {
      const cmp = await gh(`repos/${s.repo}/compare/${s.commit}...HEAD`)
      const files = (cmp.files || []).map((f) => f.filename).filter((f) => watched(f, s.paths))
      if (files.length) drift++
      rows.push(`| ${s.id} | \`${s.commit.slice(0, 7)}\` → \`${(cmp.commits?.at(-1)?.sha || s.commit).slice(0, 7)}\` | ${cmp.ahead_by ?? 0} | ${files.length ? files.slice(0, 8).map((f) => `\`${f}\``).join(', ') + (files.length > 8 ? ` +${files.length - 8}` : '') : '—'} |`)
    } catch (e) { drift++; rows.push(`| ${s.id} | \`${s.commit.slice(0, 7)}\` | ? | ⚠ ${e.message} |`) }
  }
  console.log(`# Source drift — ${new Date().toISOString().slice(0, 10)}\n\n**${drift} source(s) need re-review.** A changed watched path means the prompt, hooks or rules we reviewed are different upstream: re-run \`/engineering-standard:intake\` for that source before moving its pin (AGT-5).\n\n| Source | Pin → upstream | Commits ahead | Watched files changed |\n|---|---|---|---|\n${rows.join('\n')}`)
  return drift
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--upstream')) process.exit((await upstream()) ? 1 : 0)
  const { errors, count } = check()
  for (const e of errors) console.error(`✗ ${e}`)
  console.log(`${count} source(s), ${errors.length} error(s)`)
  process.exit(errors.length ? 1 : 0)
}

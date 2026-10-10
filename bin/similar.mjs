#!/usr/bin/env node
// Rule similarity — keeps the standard free of near-duplicate rules (one fact, one owner). Zero deps.
//   node bin/similar.mjs [--min 0.5] [--top 40]     pairs of existing rules that overlap, most similar first
//   node bin/similar.mjs --check                    CI: every pair at the threshold is merged or listed in plugin/similarity.json
// Also imported by bin/consume.mjs: every proposed rule is scored against the standard before it is added.
// Score = overlap coefficient of the rules' content terms (|A∩B| / min(|A|,|B|)) on stemmed words ≥ 4 letters,
// ignoring rule IDs, stop words and words that appear in more than 4% of rules (too common to signal sameness).
import { readFileSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = process.env.STANDARD_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const STOP = new Set('must should never every each with that this from into when where which their there than then them they have does only also more most less like such same used uses using what will would could rule rules repo repos code agent agents mode quick client test tests file files data user users page pages app apps make makes made keep keeps kept stays stay without within before after other others both either over under once ones first last real need needs needed any all and the for are not its via per one two'.split(' '))
const stem = (w) => w.replace(/(ations?|ings?|ments?|ness|ies|es|ed|ly|s)$/, '')
export function terms(text) {
  return new Set(String(text).toLowerCase().replace(/\b[a-z]+-\d+\b/g, ' ').replace(/`[^`]*`/g, (m) => ' ' + m.replace(/[^a-z0-9]+/g, ' ') + ' ')
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem).filter((w) => w.length >= 4))
}
export function corpus(rules) {
  const sets = rules.map((r) => terms(`${r.title} ${r.text}`)), df = new Map()
  for (const s of sets) for (const w of s) df.set(w, (df.get(w) || 0) + 1)
  const common = new Set([...df].filter(([, n]) => n > Math.max(6, rules.length * 0.04)).map(([w]) => w))
  const strip = (s) => new Set([...s].filter((w) => !common.has(w)))
  return { sets: sets.map(strip), strip, common }
}
export function score(a, b) {
  if (!a.size || !b.size) return 0
  let n = 0; for (const w of a) if (b.has(w)) n++
  return n / Math.min(a.size, b.size)
}
// The most similar existing rules to a proposed one → [{ id, score, shared }]
export function nearest(text, rules, k = 3) {
  const { sets, strip } = corpus(rules), q = strip(terms(text))
  return rules.map((r, i) => ({ id: r.id, title: r.title, score: score(q, sets[i]), shared: [...q].filter((w) => sets[i].has(w)).slice(0, 8) }))
    .sort((x, y) => y.score - x.score).slice(0, k)
}
export function pairs(rules, min = 0.5) {
  const { sets } = corpus(rules), out = []
  for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) {
    if (Math.min(sets[i].size, sets[j].size) < 5) continue
    const s = score(sets[i], sets[j]); if (s >= min) out.push({ a: rules[i].id, b: rules[j].id, score: s, shared: [...sets[i]].filter((w) => sets[j].has(w)).slice(0, 10) })
  }
  return out.sort((x, y) => y.score - x.score)
}

export function checkOverlaps(rules) {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'plugin/similarity.json'), 'utf8')), acc = cfg.accepted || {}
  const key = (p) => `${p.a}~${p.b}`, found = pairs(rules, cfg.threshold), seen = new Set(found.map(key))
  const errors = found.filter((p) => !acc[key(p)] && !acc[`${p.b}~${p.a}`]).map((p) => `${p.a} ~ ${p.b} overlap ${p.score.toFixed(2)} (${p.shared.slice(0, 6).join(', ')}) — merge them, or record why both stay in plugin/similarity.json`)
  const stale = Object.keys(acc).filter((k) => !seen.has(k) && !seen.has(k.split('~').reverse().join('~'))).map((k) => `plugin/similarity.json: "${k}" no longer overlaps — remove it`)
  return { errors, stale, threshold: cfg.threshold, pairs: found.length }
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const flag = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d }
  const rules = JSON.parse(readFileSync(join(ROOT, 'build/rules.json'), 'utf8')).rules.filter((r) => r.prefix !== 'CORE')
  if (process.argv.includes('--check')) {
    const r = checkOverlaps(rules); for (const e of [...r.errors, ...r.stale]) console.error(`✗ ${e}`)
    console.log(`${r.pairs} overlapping pair(s) at ≥ ${r.threshold}, ${r.errors.length} unreviewed, ${r.stale.length} stale`)
    process.exit(r.errors.length + r.stale.length ? 1 : 0)
  }
  const ps = pairs(rules, flag('--min', 0.5)).slice(0, flag('--top', 40))
  for (const p of ps) console.log(`${p.score.toFixed(2)}  ${p.a.padEnd(9)} ~ ${p.b.padEnd(9)} ${p.shared.join(', ')}`)
  console.log(`${ps.length} pair(s) at ≥ ${flag('--min', 0.5)}`)
}

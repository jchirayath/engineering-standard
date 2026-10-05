#!/usr/bin/env node
// TEST-7: every feature has tagged tests of every required kind. Zero dependencies.
//   node check-tests.mjs [--config standard.config.json] [--report]
//
// standard.config.json (repo-owned):
// {
//   "tests": {
//     "features": ["home", "invoices"],                       // explicit inventory (optional)
//     "discover": [                                            // pull feature keys from the nav/router source
//       { "file": "lib/core/navigation/routes.dart", "regex": "path:\\s*'/([a-z0-9-]+)" }
//     ],
//     "ignore": ["login", "splash"],                           // routes that are not features
//     "kinds": {                                               // which files count as which kind
//       "unit":        ["test/unit/**", "**/*.test.ts"],
//       "integration": ["test/integration/**", "supabase/tests/**"],
//       "e2e":         ["integration_test/journeys/**", "e2e/journeys/**"],
//       "walkthrough": ["integration_test/walk/**", "e2e/walk/**"]
//     },
//     "required": ["unit", "integration", "e2e", "walkthrough"],
//     "allowMissing": { "reports": { "kinds": ["walkthrough"], "until": "2026-12-31", "reason": "screen being redesigned" } }
//   }
// }
// A test file covers feature X when it contains the tag  @feature:X  (in a test name, comment or tag list).
// A file may also force its kind with  @kind:walkthrough  (overrides the path globs).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const args = process.argv.slice(2)
const cfgPath = resolve(args.includes('--config') ? args[args.indexOf('--config') + 1] : 'standard.config.json')
const report = args.includes('--report')
if (!existsSync(cfgPath)) { console.log(`– no ${relative(process.cwd(), cfgPath)}; TEST-7 check skipped (add a "tests" block to enable it)`); process.exit(0) }
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')).tests
if (!cfg) { console.log('– no "tests" block in standard.config.json; TEST-7 check skipped'); process.exit(0) }
const root = process.cwd()

const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
  .replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*') + '$')
const SKIP = new Set(['node_modules', '.git', 'build', 'dist', '.dart_tool', '.next', 'Pods', '.venv', 'coverage'])
const TEST_EXT = /\.(dart|ts|tsx|js|jsx|mjs|go|py|swift|sql)$/
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue
    const p = join(dir, e), s = statSync(p)
    if (s.isDirectory()) walk(p, out); else if (TEST_EXT.test(e)) out.push(relative(root, p))
  }
  return out
}

// 1. Feature inventory = explicit ∪ discovered − ignore
const features = new Set(cfg.features || [])
for (const d of cfg.discover || []) {
  if (!existsSync(d.file)) { console.error(`✗ discover file not found: ${d.file}`); process.exit(1) }
  const re = new RegExp(d.regex, 'g'), src = readFileSync(d.file, 'utf8')
  for (const m of src.matchAll(re)) if (m[1]) features.add(m[1])
}
for (const i of cfg.ignore || []) features.delete(i)
if (!features.size) { console.error('✗ no features found — set tests.features or tests.discover'); process.exit(1) }

// 2. Scan tests for @feature tags and classify by kind
const kinds = Object.entries(cfg.kinds || {}).map(([k, gs]) => [k, gs.map(globRe)])
const required = cfg.required || ['unit', 'integration', 'e2e', 'walkthrough']
const cover = {}  // feature → kind → [files]
const unknownTags = new Set()
for (const f of walk(root)) {
  const src = readFileSync(f, 'utf8')
  const tags = [...src.matchAll(/@feature:([a-z0-9][\w.-]*)/gi)].map(m => m[1])
  if (!tags.length) continue
  const forced = src.match(/@kind:(\w+)/)?.[1]
  const fileKinds = forced ? [forced] : kinds.filter(([, res]) => res.some(r => r.test(f))).map(([k]) => k)
  for (const t of new Set(tags)) {
    if (!features.has(t)) { unknownTags.add(`${t} (${f})`); continue }
    for (const k of fileKinds) ((cover[t] ||= {})[k] ||= []).push(f)
  }
}

// 3. Report
const today = new Date().toISOString().slice(0, 10)
let failures = 0, waived = 0
const rows = []
for (const feat of [...features].sort()) {
  const allow = cfg.allowMissing?.[feat]
  const allowed = allow && allow.until >= today ? new Set(allow.kinds) : new Set()
  if (allow && allow.until < today) console.error(`✗ ${feat}: allowMissing expired ${allow.until} (${allow.reason || 'no reason'})`), failures++
  const cells = required.map(k => {
    const n = cover[feat]?.[k]?.length || 0
    if (n) return `${k}:${n}`
    if (allowed.has(k)) { waived++; return `${k}:waived` }
    failures++; return `${k}:MISSING`
  })
  rows.push([feat, cells])
}
if (report || failures) for (const [feat, cells] of rows) {
  const bad = cells.some(c => c.endsWith('MISSING'))
  if (report || bad) console.log(`${bad ? '✗' : '✓'} ${feat.padEnd(24)} ${cells.join('  ')}`)
}
for (const u of unknownTags) console.warn(`⚠ @feature tag for unknown feature: ${u}`)
console.log(`${failures ? '✗' : '✓'} TEST-7: ${features.size} features × ${required.length} kinds — ${failures} missing, ${waived} waived`)
process.exit(failures ? 1 : 0)

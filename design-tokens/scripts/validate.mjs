#!/usr/bin/env node
// Validate an app's design tokens against the shared vocabulary (ENGINEERING_STANDARD §6A).
//   node validate.mjs [--design design] [--schema path/to/semantic-keys.json]
// Checks, per mode (light, dark, every presets/*.json):
//   1. every required key exists (THEME-4)      4. every reference resolves, no cycles
//   2. no unknown keys outside extension spaces  5. WCAG contrast for declared pairs (THEME-7)
//   3. every colour is #RGB/#RRGGBB/#RRGGBBAA    6. icons.json covers every required icon (THEME-5)
// Zero dependencies. Exit 1 on any error.
import { existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load, flatten, resolveAll, loadTokens, HEX, rgba, contrast } from './lib.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) =>
  (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []))
const here = dirname(fileURLToPath(import.meta.url))
const designDir = resolve(args.design || 'design')
const tokensDir = join(designDir, 'tokens')
const schemaPath = resolve(args.schema || join(here, '..', 'schema', 'semantic-keys.json'))

const errors = [], warnings = []
const err = (m) => errors.push(m), warn = (m) => warnings.push(m)
if (!existsSync(tokensDir)) { console.error(`✗ no tokens dir at ${tokensDir}`); process.exit(1) }
const schema = load(schemaPath)

const t = loadTokens(tokensDir, schema.modes)
t.missing.forEach(f => err(`missing ${f}`))
const { primitive, base } = t
const modes = { ...t.modes }
for (const [name, p] of Object.entries(t.presets)) modes[`preset:${name}(${p.extends})`] = p.tokens

const requiredColor = new Set(schema.required.color), requiredBase = new Set(schema.required.base)
const isExtension = (k) => schema.extensionNamespaces.some(ns => k.startsWith(ns))
const exempt = new Set(schema.contrastExempt)

// Base (mode-independent)
for (const k of requiredBase) if (!(k in base)) err(`base.json: missing required key ${k}`)
for (const k of Object.keys(base)) if (!requiredBase.has(k) && !isExtension(k)) err(`base.json: unknown key ${k} (rename? add under an extension namespace instead)`)

let pairsChecked = 0
for (const [mode, sem] of Object.entries(modes)) {
  for (const k of requiredColor) if (!(k in sem)) err(`${mode}: missing required key ${k}`)
  for (const k of Object.keys(sem)) if (!requiredColor.has(k) && !isExtension(k)) err(`${mode}: unknown key ${k} (rename? use color.domain.* for app-specific colours)`)
  const resolved = resolveAll({ ...primitive, ...base, ...sem }, mode, err)
  const col = (k) => resolved[k]
  for (const k of Object.keys(sem)) {
    const v = col(k)
    if (v !== undefined && !HEX.test(v)) err(`${mode}: ${k} = ${JSON.stringify(v)} is not #RGB/#RRGGBB/#RRGGBBAA`)
  }
  const check = (fg, bg, min) => {
    if (exempt.has(fg) || exempt.has(bg)) return
    const a = col(fg), b = col(bg)
    if (!a || !b || !HEX.test(a) || !HEX.test(b)) return
    if (rgba(a).a < 1 || rgba(b).a < 1) { warn(`${mode}: ${fg} on ${bg} uses alpha — contrast not checked`); return }
    pairsChecked++
    const r = contrast(a, b)
    if (r < min) err(`${mode}: contrast ${fg} (${a}) on ${bg} (${b}) = ${r.toFixed(2)}:1 < ${min}:1`)
  }
  for (const p of schema.contrastPairs) {
    if (p.pairsByPrefix) {
      // X / onX siblings: color.status.danger + color.status.onDanger
      for (const k of Object.keys(sem)) {
        const m = k.match(/^(.*)\.on([A-Z]\w*)$/); if (!m) continue
        const bg = `${m[1]}.${m[2][0].toLowerCase()}${m[2].slice(1)}`
        if (bg in sem) check(k, bg, p.min)
      }
      continue
    }
    const fgs = p.fg.endsWith('*') ? Object.keys(sem).filter(k => k.startsWith(p.fg.slice(0, -1))) : [p.fg]
    for (const fg of fgs) for (const bg of p.bg) check(fg, bg, p.min)
  }
}

// Icons
const iconsPath = join(designDir, 'icons.json')
if (!existsSync(iconsPath)) err(`missing ${iconsPath}`)
else {
  const icons = load(iconsPath).icons || {}
  const platforms = Object.values(schema.icons.platforms)
  for (const n of schema.icons.required) {
    if (!icons[n]) { err(`icons.json: missing required icon ${n}`); continue }
    for (const p of platforms) if (!icons[n][p]) warn(`icons.json: ${n} has no "${p}" glyph`)
  }
  for (const n of Object.keys(icons)) if (!schema.icons.required.includes(n) && !n.startsWith('domain.'))
    err(`icons.json: unknown icon ${n} (app-specific icons go under domain.*)`)
}

for (const w of warnings) console.warn(`⚠ ${w}`)
for (const e of errors) console.error(`✗ ${e}`)
console.log(`${errors.length ? '✗' : '✓'} tokens ${designDir} — ${Object.keys(modes).length} modes, ${pairsChecked} contrast pairs, schema v${schema.version}: ${errors.length} errors, ${warnings.length} warnings`)
process.exit(errors.length ? 1 : 0)

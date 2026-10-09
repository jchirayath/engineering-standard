#!/usr/bin/env node
// ENGINEERING_STANDARD.md → build/rules.json (the plugin's, MCP server's and hooks' only rule source). Zero deps.
//   node bin/build-rules.mjs            regenerate build/rules.json + MODES.md (commit both)
//   node bin/build-rules.mjs --check    CI: fail on duplicate IDs, references to undefined IDs, a stale
//                                       rules.json/MODES.md, plugin/modes.json naming undefined rules, or
//                                       .claude-plugin versions != VERSION; warn on quick→client-only references
// Definitions recognised (generic over any PREFIX-n):
//   - **ID LEVEL…** text          (bullet or bare paragraph; LEVEL = MUST|SHOULD|MAY + any qualifier)
//   | **ID LEVEL…** | text | …    (table row)        | ID | LEVEL… | text | …   (table row, level column)
//   | ID | … |                    (table row without level → level of the enclosing heading, else MUST)
//   ### ID · title (LEVEL — …)    (heading; text = heading + first paragraph)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { ROOT, readJSON, extractRefs, kitVersion } from '../lib/rules.mjs'
import { modesFor } from '../lib/modes.mjs'

const CHECK = process.argv.includes('--check')
const MD = join(ROOT, 'ENGINEERING_STANDARD.md'), OUT = join(ROOT, 'build/rules.json'), MODES_MD = join(ROOT, 'MODES.md')
const LEVEL = /\b(MUST|SHOULD|MAY)\b/
const ID_ONLY = /^([A-Z]{1,8}-\d+)$/
const BOLD_DEF = /^\s*(?:[-*]\s+)?\*\*([A-Z]{1,8}-\d+)\s+((?:MUST|SHOULD|MAY)\b[^*]*?)\*\*\s*(.*)$/
const clean = (s) => s.replace(/\s+/g, ' ').replace(/^[—–:\-\s]+/, '').trim()
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim())
const unbold = (s) => s.replace(/\*\*/g, '').trim()

export function parse(md) {
  const lines = md.split('\n'), defs = [], pillars = []
  let section = '', sectionNo = '', subsection = '', fence = false, cur = null, headers = null, tail = null
  const flush = () => { if (cur) { cur.text = clean(cur.text); defs.push(cur); tail = cur.heading || cur.table ? null : cur; cur = null } }
  const start = (id, levelText, text, line, extra = {}) => {
    flush()
    cur = { id, prefix: id.split('-')[0], level: levelText.match(LEVEL)[1], levelText: clean(levelText), section, sectionNo, subsection, text, line, ...extra }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) { flush(); fence = !fence; continue }
    if (fence) continue
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flush(); headers = null; tail = null
      const t = h[2].trim()
      if (h[1].length <= 2) { section = t; sectionNo = (t.match(/^([0-9]+[A-Z]?)\s*·/) || [])[1] || ''; subsection = '' } else subsection = t
      const hd = t.match(/^([A-Z]{1,8}-\d+)\b\s*[·:—–-]?\s*(.*)$/)
      if (hd && LEVEL.test(hd[2])) {
        const lv = hd[2].slice(hd[2].search(LEVEL)).split(/\s[—–]\s|\)/)[0]
        start(hd[1], lv, hd[2], i + 1, { heading: true })
      }
      continue
    }
    if (/^\s*\|/.test(line)) {
      if (/^\s+\|/.test(line) && (cur && !cur.heading ? (cur.text += ' ' + line.trim(), true) : tail ? (tail.text = clean(tail.text + ' ' + line.trim()), true) : false)) continue
      const c = cells(line)
      if (/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) { flush(); headers = c; continue }   // header row
      if (/^:?-{3,}/.test(c[0])) continue                                                      // separator
      flush()
      if (sectionNo === '0' && /^\d+$/.test(c[0])) { pillars.push({ n: +c[0], name: unbold(c[1] || ''), bar: unbold(c[2] || '') }); continue }
      let id, levelText, rest, cols
      const b = c[0].match(/^\*\*([A-Z]{1,8}-\d+)\s+((?:MUST|SHOULD|MAY)\b[^*]*)\*\*$/)
      if (b) { [, id, levelText] = b; rest = c.slice(1); cols = (headers || []).slice(1) }
      else if (ID_ONLY.test(unbold(c[0]))) {
        id = unbold(c[0])
        if (/^\**(MUST|SHOULD|MAY)\b/.test(c[1] || '')) { levelText = unbold(c[1]); rest = c.slice(2); cols = (headers || []).slice(2) }
        else { const lv = (section + ' ' + subsection).match(LEVEL); levelText = `${lv ? lv[1] : 'MUST'} (section)`; rest = c.slice(1); cols = (headers || []).slice(1) }
      }
      if (!id) continue
      const parts = [], extra = {}
      rest.forEach((v, k) => {
        const hn = (cols[k] || '').replace(/\*/g, '').trim()
        if (!v || /^(this repo|conf\.?|confidence|status)$/i.test(hn)) return
        if (/enforc/i.test(hn)) { extra.enforcedText = clean(v); return }
        parts.push(k === 0 || !hn || /^(rule|text|description)$/i.test(hn) ? v : `${hn}: ${v}`)
      })
      start(id, levelText, parts.join(' · '), i + 1, { ...extra, table: true }); flush()
      continue
    }
    const d = line.match(BOLD_DEF)
    if (d) { start(d[1], d[2], d[3], i + 1); continue }
    if (!line.trim()) { if (cur && (!cur.heading || cur.text.length > 0)) { if (cur.heading && !cur.para) { cur.para = true; continue } flush() } continue }
    if (cur && !/^[-*]\s/.test(line)) { cur.text += ' ' + line.trim(); continue }
    flush(); if (!/^\s/.test(line)) tail = null
  }
  flush()
  return { defs, pillars }
}

function titleOf(text) {
  const b = text.match(/^\*\*([^*]{3,80})\*\*/)
  let t = b ? b[1] : text.split(/(?<=[a-z)`])[.;:]\s|\s[—–]\s|\s\(/)[0]
  t = t.replace(/[*`]/g, '').replace(/[:.]$/, '').trim()
  return t.length > 72 ? t.slice(0, 70).replace(/\s\S*$/, '') + '…' : t
}

function semgrepIndex(prefixes) {
  const idx = {}, dir = join(ROOT, 'semgrep')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
    for (const block of readFileSync(join(dir, f), 'utf8').split(/\n\s*-\s+id:\s*/).slice(1)) {
      const rid = block.match(/^([\w.-]+)/)[1]
      const std = block.match(/standard:\s*\[([^\]]*)\]/)
      for (const id of extractRefs(std ? std[1] : (block.match(/message:.*$/m) || [''])[0], prefixes)) (idx[id] ||= []).push(rid)
    }
  }
  return idx
}

export function build() {
  const md = readFileSync(MD, 'utf8'), stacksMap = readJSON(join(ROOT, 'plugin/stacks.json')), modesMap = readJSON(join(ROOT, 'plugin/modes.json'))
  const { defs, pillars } = parse(md)
  const prefixes = new Set([...defs.map((d) => d.prefix), ...Object.keys(stacksMap.prefixes)])
  const sem = semgrepIndex(prefixes)
  const seen = new Set()
  const rules = defs.filter((d) => !seen.has(d.id) && seen.add(d.id)).map((d) => {
    const stacks = stacksMap.ids[d.id] || stacksMap.subsections[d.subsection] || stacksMap.sections[d.sectionNo] || stacksMap.prefixes[d.prefix] || ['all']
    const enforcedBy = [...(sem[d.id] || []).map((s) => `semgrep:${s}`), ...(stacksMap.enforcedBy[d.id] || [])]
    if (d.enforcedText) enforcedBy.push(`doc:${d.enforcedText}`)
    const eb = d.text.match(/\*Enforced by:?\*:?\s*(.+)$/i)
    if (eb) enforcedBy.push(`doc:${eb[1].replace(/[*_]/g, '').trim()}`)
    const r = { id: d.id, prefix: d.prefix, level: d.level, levelText: d.levelText, section: d.section, sectionNo: d.sectionNo,
      subsection: d.subsection, title: titleOf(d.text), text: d.text, refs: extractRefs(d.text, prefixes).filter((x) => x !== d.id), stacks,
      modes: modesFor(d.id, modesMap) }
    if (enforcedBy.length) r.enforcedBy = enforcedBy
    return r
  })
  const counts = { total: rules.length }
  for (const r of rules) counts[r.level] = (counts[r.level] || 0) + 1
  counts.byMode = Object.fromEntries(modesMap.modes.map((m) => {
    const c = { total: 0 }; for (const r of rules) if (r.modes.includes(m)) { c.total++; c[r.level] = (c[r.level] || 0) + 1 }
    return [m, c]
  }))
  const head = { $comment: 'GENERATED by bin/build-rules.mjs from ENGINEERING_STANDARD.md + plugin/modes.json — never edit; regenerate and commit.',
    version: kitVersion(), title: md.split('\n')[0].replace(/^#\s*/, ''), pillars, stacks: stacksMap.stacks, modes: modesMap.modes, defaultMode: modesMap.default, counts }
  const json = JSON.stringify(head, null, 1).replace(/\n}$/, ',\n "rules": [\n') + rules.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n ]\n}\n'
  return { json, modesMd: modesMarkdown(rules, counts, head.version), defs, rules, prefixes, stacksMap, modesMap }
}

function modesMarkdown(rules, counts, version) {
  const q = counts.byMode.quick, c = counts.byMode.client, cell = (s) => s.replace(/\|/g, '\\|')
  const out = ['# Standard modes — which rules apply in quick vs client', '',
    `> GENERATED by \`bin/build-rules.mjs\` from \`plugin/modes.json\` + \`ENGINEERING_STANDARD.md\` (v${version}) — never edit; edit those and regenerate.`,
    `> Modes are nested (quick ⊂ client). **quick** — prototypes, personal/internal tools: ${q.total} rules (${q.MUST || 0} MUST). ` +
    `**client** — anything with external users: all ${c.total} rules (${c.MUST || 0} MUST). Declare the mode in \`standard.config.json\` → \`"mode"\` (§0A).`]
  let sec
  for (const r of rules) {
    if (r.section !== sec) { sec = r.section; out.push('', `## ${sec}`, '', '| Rule | Level | Title | Quick | Client |', '|---|---|---|:-:|:-:|') }
    out.push(`| ${r.id} | ${r.level} | ${cell(r.title)} | ${r.modes.includes('quick') ? '✓' : '—'} | ✓ |`)
  }
  return out.join('\n') + '\n'
}

function walk(p, out = []) {
  const s = statSync(p)
  if (s.isDirectory()) { for (const e of readdirSync(p)) if (!['node_modules', '.git'].includes(e)) walk(join(p, e), out) }
  else if (/\.(md|json|ya?ml|mjs|js|sh|html|conf|toml|txt)$|^(Caddyfile|htaccess)$/.test(basename(p))) out.push(p)
  return out
}

function check({ json, modesMd, defs, rules, prefixes, stacksMap, modesMap }) {
  const errors = [], warnings = []
  const count = new Map()
  for (const d of defs) (count.get(d.id) || count.set(d.id, []).get(d.id)).push(d.line)
  for (const [id, at] of count) if (at.length > 1) errors.push(`duplicate definition ${id} at ENGINEERING_STANDARD.md lines ${at.join(', ')}`)

  const defined = new Set(defs.map((d) => d.id))
  const files = ['ENGINEERING_STANDARD.md', 'APP_REVIEW.md', 'README.md', 'mappings/asvs-map.json']
    .map((f) => join(ROOT, f)).filter(existsSync)
  for (const f of readdirSync(join(ROOT, 'semgrep'))) if (f.endsWith('.yml')) files.push(join(ROOT, 'semgrep', f))
  for (const f of readdirSync(join(ROOT, 'bin'))) if (f !== 'build-rules.mjs') files.push(join(ROOT, 'bin', f))
  files.push(...walk(join(ROOT, 'site')))
  const undef = new Map()
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      for (const id of extractRefs(l, prefixes)) if (!defined.has(id)) (undef.get(id) || undef.set(id, []).get(id)).push(`${relative(ROOT, f)}:${i + 1}`)
    })
  }
  for (const [id, at] of [...undef].sort()) errors.push(`${id} referenced but never defined — ${at.slice(0, 4).join(', ')}${at.length > 4 ? ` (+${at.length - 4})` : ''}`)

  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (cur !== json) errors.push('build/rules.json is stale — run `node bin/build-rules.mjs` and commit it')
  if ((existsSync(MODES_MD) ? readFileSync(MODES_MD, 'utf8') : '') !== modesMd) errors.push('MODES.md is stale — run `node bin/build-rules.mjs` and commit it')

  // plugin/modes.json: names only defined rules/prefixes; the default is a mode; quick ⊂ client holds by construction.
  const q = modesMap.quick || {}, ruleP = new Set(defs.map((d) => d.prefix))
  if (!modesMap.modes?.includes('quick') || !modesMap.modes?.includes('client') || !modesMap.modes.includes(modesMap.default)) errors.push('plugin/modes.json: modes must list quick + client and default must be one of them')
  for (const p of q.prefixes || []) if (!ruleP.has(p)) errors.push(`plugin/modes.json quick.prefixes: ${p} has no defined rules`)
  for (const k of ['ids', 'quickExclude']) for (const id of q[k] || []) if (!defined.has(id)) errors.push(`plugin/modes.json quick.${k}: ${id} is not defined in ENGINEERING_STANDARD.md`)
  for (const id of q.quickExclude || []) if ((q.ids || []).includes(id) || !(q.prefixes || []).includes(id.split('-')[0])) warnings.push(`plugin/modes.json quickExclude ${id} has no effect (listed in ids, or its prefix is not a quick prefix)`)
  const byId = new Map(rules.map((r) => [r.id, r])), cross = []
  for (const r of rules) if (r.modes.includes('quick')) {
    const to = r.refs.filter((x) => byId.get(x) && !byId.get(x).modes.includes('quick') && !(q.reviewedPointers || {})[`${r.id}>${x}`])
    if (to.length) cross.push(`${r.id} (${r.level}) → ${to.join(', ')}`)
  }
  for (const k of Object.keys(q.reviewedPointers || {})) {               // a reviewed pointer that no longer exists is stale
    const [a, b] = k.split('>'), ra = byId.get(a)
    if (!ra || !ra.refs.includes(b) || !ra.modes.includes('quick') || byId.get(b)?.modes.includes('quick')) warnings.push(`plugin/modes.json reviewedPointers "${k}" is stale — remove it`)
  }

  const v = kitVersion()
  for (const f of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
    if (!existsSync(join(ROOT, f))) { errors.push(`${f} missing`); continue }
    const j = readJSON(join(ROOT, f)), pv = j.version ?? j.plugins?.find((p) => p.source === './')?.version
    if (pv !== undefined && pv !== v) errors.push(`${f} version ${pv} != VERSION ${v}`)
  }

  for (const p of new Set(defs.map((d) => d.prefix))) if (!stacksMap.prefixes[p]) warnings.push(`prefix ${p} not in plugin/stacks.json → defaults to [all]`)
  for (const k of ['ids', 'enforcedBy']) for (const id of Object.keys(stacksMap[k])) if (!defined.has(id)) warnings.push(`plugin/stacks.json ${k}.${id}: rule not defined (yet)`)
  for (const d of defs) if (!d.text) warnings.push(`${d.id} (line ${d.line}) has no text`)
  return { errors, warnings, cross }
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))
if (isMain) {
  const b = build()
  if (CHECK) {
    const { errors, warnings, cross } = check(b)
    for (const w of warnings) console.log(`⚠ ${w}`)
    if (cross.length) console.log(`⚠ ${cross.length} quick-mode rule(s) reference client-only rules — review for conflicts:\n${cross.map((x) => `    ${x}`).join('\n')}`)
    for (const e of errors) console.error(`✗ ${e}`)
    const bm = JSON.parse(b.json).counts.byMode
    console.log(`${b.rules.length} rules (${b.prefixes.size} prefixes; quick ${bm.quick.total}, client ${bm.client.total}), ${errors.length} error(s), ${warnings.length + cross.length} warning(s)`)
    process.exit(errors.length ? 1 : 0)
  }
  mkdirSync(join(ROOT, 'build'), { recursive: true })
  writeFileSync(OUT, b.json); writeFileSync(MODES_MD, b.modesMd)
  const dups = b.defs.length - b.rules.length
  console.log(`✓ build/rules.json: ${b.rules.length} rules, ${b.json.length} bytes${dups ? ` (⚠ ${dups} duplicate definition(s) — run --check)` : ''}; MODES.md written`)
}

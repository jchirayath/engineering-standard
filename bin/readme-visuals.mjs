#!/usr/bin/env node
// README visuals, generated from the repo's own data so they never drift (CI runs --check). Zero deps.
//   docs/img/hero-{light,dark}.svg            banner with live counts (rules, MUST, quick mode, enforced, sources)
//   docs/img/rules-by-area-{light,dark}.svg   rules per area, grouped by pillar; solid = in quick mode
//   docs/img/built-on-{light,dark}.svg        the scout's standards watch list (by group) + every reviewed source
//
//   node bin/readme-visuals.mjs          (re)write the SVGs
//   node bin/readme-visuals.mjs --check  exit 1 if any SVG is out of date
//
// Palette: the dataviz reference categorical slots 1–6, validated (light + dark) with the skill's validator; light
// slots under 3:1 get relief from the visible row labels and counts. Text never wears a series colour.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = process.env.STANDARD_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => join(ROOT, ...a)
const OUT = P('docs/img')

export const THEMES = {
  light: { page: '#f9f9f7', surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', base: '#c3c2b7',
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'], accent: '#2a78d6', chip: '#f0efec', tint: 0.32 },
  dark: { page: '#0d0d0d', surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', base: '#383835',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'], accent: '#3987e5', chip: '#262624', tint: 0.45 },
}
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const textW = (s, size) => Math.ceil(String(s).length * size * 0.56)      // system sans, rough average advance

// Areas (section numbers) grouped under the five pillars, plus the proof layer that makes them hold.
export const GROUPS = [
  { name: 'Secure', sections: ['2', '2A', '2B', '2C', '2D', '2E', '2F', '6C', '6I'] },
  { name: 'Optimized', sections: ['3', '3A', '3B'] },
  { name: 'Shared', sections: ['1', '6K'] },
  { name: 'Observable', sections: ['5', '6E', '6H'] },
  { name: 'Consistent', sections: ['6', '6A', '6B', '6G', '6J'] },
  { name: 'Proven', sections: ['4', '6D', '6F', '7'] },
]

export function stats(rules = JSON.parse(readFileSync(P('build/rules.json'), 'utf8')), sources = JSON.parse(readFileSync(P('sources/registry.json'), 'utf8')).sources) {
  const list = rules.rules
  const enforced = list.filter((r) => (r.enforcedBy || []).some((e) => !/^doc:/.test(e))).length
  const semgrep = existsSync(P('semgrep')) ? readdirSync(P('semgrep')).filter((f) => f.endsWith('.yml')).reduce((n, f) => n + (readFileSync(P('semgrep', f), 'utf8').match(/^ {2}- id:/gm) || []).length, 0) : 0
  const areas = new Map()
  for (const r of list) {
    const a = areas.get(r.sectionNo) || { no: r.sectionNo, name: r.section.replace(/^[\dA-Z]+ · /, '').replace(/\s*[—(].*$/, '').replace(/\*/g, '').trim(), total: 0, quick: 0 }
    a.total++; if (r.modes.includes('quick')) a.quick++; areas.set(r.sectionNo, a)
  }
  const grouped = new Set(GROUPS.flatMap((g) => g.sections))
  const missing = [...areas.keys()].filter((k) => !grouped.has(k))
  if (missing.length) throw new Error(`readme-visuals: section(s) ${missing.join(', ')} are not in a GROUPS pillar — add them`)
  return { total: list.length, must: rules.counts.MUST, quick: rules.counts.byMode.quick.total, enforced, sources: sources.length, semgrep,
    areas: GROUPS.map((g) => ({ ...g, areas: g.sections.map((s) => areas.get(s)).filter(Boolean) })) }
}

// ── hero banner ─────────────────────────────────────────────────────────────────────────────────────────────
export function hero(s, mode) {
  const t = THEMES[mode], W = 1200, H = 300
  const chips = [[s.total, 'rules'], [s.must, 'MUST'], [s.quick, 'in quick mode'], [s.enforced, 'checked by tooling'], [s.sources, 'reviewed sources'], ['daily', 'security scout']]
  const gapX = 12, w = (W - 112 - gapX * (chips.length - 1)) / chips.length    // an even grid across the banner
  const chipSvg = chips.map(([n, label], i) => `<g transform="translate(${(56 + i * (w + gapX)).toFixed(1)},186)">
    <rect width="${w.toFixed(1)}" height="70" rx="12" fill="${t.chip}"/>
    <text x="18" y="36" font-family="${FONT}" font-size="28" font-weight="700" fill="${t.ink}">${esc(n)}</text>
    <text x="18" y="57" font-family="${FONT}" font-size="13" fill="${t.ink2}">${esc(label)}</text></g>`).join('\n  ')
  const pills = GROUPS.slice(0, 5).map((g, i) => [g.name, t.series[i]])
  let px = 56; const pillSvg = pills.map(([name, c]) => { const w = textW(name, 13) + 30, g = `<g transform="translate(${px},146)"><circle cx="8" cy="10" r="5" fill="${c}"/><text x="20" y="15" font-family="${FONT}" font-size="13" font-weight="600" fill="${t.ink2}">${esc(name)}</text></g>`; px += w + 10; return g }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
  <title id="t">engineering-standard</title>
  <desc id="d">${s.total} rules (${s.must} MUST, ${s.quick} in quick mode), ${s.enforced} checked by tooling, ${s.sources} reviewed sources, kept current by a daily security scout.</desc>
  <rect width="${W}" height="${H}" rx="20" fill="${t.surface}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="20" fill="none" stroke="${t.grid}"/>
  <g transform="translate(${W - 56 - 172 * 0.62},26) scale(0.62)">${shield(t)}</g>
  <text x="56" y="84" font-family="${MONO}" font-size="40" font-weight="700" fill="${t.ink}">engineering-standard</text>
  <text x="56" y="122" font-family="${FONT}" font-size="19" fill="${t.ink2}">The rules AI coding agents build to — and the hooks, checks and CI that hold them to it.</text>
  ${pillSvg}
  ${chipSvg}
</svg>
`
}
function shield(t) {   // a shield with a check mark, built from the theme's ramps (decorative)
  const bars = t.series.slice(0, 5).map((c, i) => `<rect x="${18 + i * 26}" y="${150 - [60, 92, 74, 110, 84][i]}" width="16" height="${[60, 92, 74, 110, 84][i]}" rx="4" fill="${c}" opacity="0.85"/>`).join('')
  return `<path d="M86 0 L172 30 V100 C172 160 132 200 86 220 C40 200 0 160 0 100 V30 Z" fill="${t.chip}" stroke="${t.base}" stroke-width="2"/>
    <g clip-path="url(#sc)"><clipPath id="sc"><path d="M86 0 L172 30 V100 C172 160 132 200 86 220 C40 200 0 160 0 100 V30 Z"/></clipPath>${bars}</g>
    <path d="M52 108 L78 134 L126 82" fill="none" stroke="${t.ink}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`
}

// ── rules by area (grouped horizontal bars; solid = in quick mode, tint = client mode only) ────────────────
export function byArea(s, mode) {
  const t = THEMES[mode], W = 1200, rowH = 22, gap = 4, headH = 30, labelW = 330, valueW = 70, top = 92, left = 40
  const max = Math.max(...s.areas.flatMap((g) => g.areas.map((a) => a.total)))
  const plotW = W - left - labelW - valueW - 40, scale = (n) => (n / max) * plotW
  let y = top; const rows = []
  s.areas.forEach((g, gi) => {
    const c = t.series[gi], total = g.areas.reduce((n, a) => n + a.total, 0)
    rows.push(`<g transform="translate(${left},${y})"><rect y="6" width="12" height="12" rx="3" fill="${c}"/><text x="20" y="17" font-family="${FONT}" font-size="15" font-weight="700" fill="${t.ink}">${esc(g.name)}</text><text x="${28 + textW(g.name, 15)}" y="17" font-family="${FONT}" font-size="13" fill="${t.muted}">${total} rules</text></g>`)
    y += headH
    for (const a of g.areas) {
      const bx = left + labelW, qw = scale(a.quick), cw = scale(a.total - a.quick)
      const label = `§${a.no} ${a.name}`.length > 44 ? `§${a.no} ${a.name}`.slice(0, 43) + '…' : `§${a.no} ${a.name}`
      rows.push(`<g><title>§${esc(a.no)} ${esc(a.name)}: ${a.total} rules, ${a.quick} in quick mode</title>
    <text x="${left + 20}" y="${y + 15}" font-family="${FONT}" font-size="13" fill="${t.ink2}">${esc(label)}</text>
    ${qw > 0 ? `<rect x="${bx}" y="${y + 3}" width="${Math.max(qw - (cw > 0 ? 1 : 0), 1).toFixed(1)}" height="${rowH - 6}" rx="4" fill="${c}"/>` : ''}
    ${cw > 0 ? `<rect x="${(bx + qw + (qw > 0 ? 1 : 0)).toFixed(1)}" y="${y + 3}" width="${Math.max(cw - (qw > 0 ? 1 : 0), 1).toFixed(1)}" height="${rowH - 6}" rx="4" fill="${c}" opacity="${t.tint}"/>` : ''}
    <text x="${(bx + qw + cw + 8).toFixed(1)}" y="${y + 15}" font-family="${FONT}" font-size="12" fill="${t.ink2}">${a.total}${a.quick ? ` · ${a.quick} quick` : ''}</text></g>`)
      y += rowH + gap
    }
    y += 10
  })
  const H = y + 20, lg = THEMES[mode].series[0]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
  <title id="t">Rules by area</title>
  <desc id="d">${s.total} rules across ${s.areas.reduce((n, g) => n + g.areas.length, 0)} areas, grouped by pillar. ${s.areas.map((g) => `${g.name}: ${g.areas.reduce((n, a) => n + a.total, 0)}`).join('; ')}. Solid bar segments are rules that also apply in quick mode (${s.quick}).</desc>
  <rect width="${W}" height="${H}" rx="20" fill="${t.surface}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="20" fill="none" stroke="${t.grid}"/>
  <text x="${left}" y="46" font-family="${FONT}" font-size="22" font-weight="700" fill="${t.ink}">${s.total} rules, by area</text>
  <g transform="translate(${left},62)" font-family="${FONT}" font-size="13" fill="${t.ink2}">
    <rect width="22" height="12" rx="3" fill="${lg}"/><text x="30" y="11">applies in quick mode too</text>
    <rect x="200" width="22" height="12" rx="3" fill="${lg}" opacity="${t.tint}"/><text x="230" y="11">client mode only</text>
  </g>
  <line x1="${left + labelW}" y1="${top}" x2="${left + labelW}" y2="${H - 30}" stroke="${t.base}" stroke-width="1"/>
  ${rows.join('\n  ')}
</svg>
`
}

// ── built on: the scout's standards watch list (by group) + every reviewed, pinned source in the registry ────
// Both files are what the daily scout maintains, so a new standard or an approved source PR redraws this.
const short = (s) => String(s).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
const fit = (s, size, max) => { s = String(s); while (s.length > 4 && textW(s, size) > max) s = s.slice(0, -2).trimEnd() + '…'; return s.replace(/……$/, '…') }
export function builtOnData(policy = JSON.parse(readFileSync(P('sources/scout-policy.json'), 'utf8')), sources = JSON.parse(readFileSync(P('sources/registry.json'), 'utf8')).sources) {
  const names = policy.standards.groups || {}
  const bands = Object.entries(names).map(([id, name]) => ({ id, name, tiles: policy.standards.list.filter((s) => s.group === id)
    .map((s) => ({ title: short(s.name), meta: /see REFERENCES/i.test(s.cited || '') ? '' : String(s.cited || '') })) }))
  const dispo = { distilled: 'ideas distilled', adopted: 'rules adopted', companion: 'companion', reference: 'reference' }
  bands.push({ id: 'projects', name: 'Reviewed agent & security projects (pinned)', tiles: [...sources].sort((a, b) => (b.informs?.length || 0) - (a.informs?.length || 0) || a.name.localeCompare(b.name))
    .map((s) => ({ title: short(s.name), meta: `${s.author || ''}${s.informs?.length ? ` · ${s.informs.slice(0, 3).join(', ')}${s.informs.length > 3 ? ` +${s.informs.length - 3}` : ''}` : ` · ${dispo[s.disposition] || s.disposition}`}` })) })
  return { bands: bands.filter((b) => b.tiles.length), standards: policy.standards.list.length, sources: sources.length }
}
export function builtOn(d, mode) {
  const t = THEMES[mode], W = 1200, left = 40, right = W - 40, tileH = 50, gx = 10, gy = 10, maxTile = 360
  let y = 104; const parts = []
  d.bands.forEach((b, bi) => {
    const c = t.series[bi % t.series.length]
    parts.push(`<g transform="translate(${left},${y})"><rect y="3" width="12" height="12" rx="3" fill="${c}"/><text x="20" y="14" font-family="${FONT}" font-size="15" font-weight="700" fill="${t.ink}">${esc(b.name)}<tspan dx="8" font-size="13" font-weight="400" fill="${t.muted}">${b.tiles.length}</tspan></text></g>`)
    y += 26; let x = left
    for (const tile of b.tiles) {
      const title = fit(tile.title, 13.5, maxTile - 30), meta = fit(tile.meta, 12, maxTile - 30)
      const w = Math.min(maxTile, Math.max(textW(title, 13.5) * 1.04, textW(meta, 12) * 0.95) + 36)
      if (x + w > right) { x = left; y += tileH + gy }
      parts.push(`<g transform="translate(${x.toFixed(1)},${y})"><title>${esc(tile.title)}${tile.meta ? ` — ${esc(tile.meta)}` : ''}</title>
    <rect width="${w.toFixed(1)}" height="${tileH}" rx="10" fill="${t.chip}"/><rect x="0" y="10" width="4" height="${tileH - 20}" rx="2" fill="${c}"/>
    <text x="16" y="${tile.meta ? 21 : 30}" font-family="${FONT}" font-size="13.5" font-weight="600" fill="${t.ink}">${esc(title)}</text>${tile.meta ? `
    <text x="16" y="38" font-family="${FONT}" font-size="12" fill="${t.ink2}">${esc(meta)}</text>` : ''}</g>`)
      x += w + gx
    }
    y += tileH + 24
  })
  const H = y + 6
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
  <title id="t">Built on</title>
  <desc id="d">${esc(`${d.standards} standards, platform policies and laws the daily scout watches, and ${d.sources} reviewed, pinned agent and security projects. ${d.bands.map((b) => `${b.name}: ${b.tiles.map((x) => x.title).join(', ')}`).join('. ')}.`)}</desc>
  <rect width="${W}" height="${H}" rx="20" fill="${t.surface}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="20" fill="none" stroke="${t.grid}"/>
  <text x="${left}" y="46" font-family="${FONT}" font-size="22" font-weight="700" fill="${t.ink}">Built on ${d.standards} standards &amp; policies and ${d.sources} reviewed projects</text>
  <text x="${left}" y="72" font-family="${FONT}" font-size="13.5" fill="${t.ink2}">Each one is watched by the daily scout: a new version or a new source arrives as a pull request with a recommendation.</text>
  ${parts.join('\n  ')}
</svg>
`
}

export function render() {
  const s = stats(), b = builtOnData(), out = {}
  for (const mode of ['light', 'dark']) { out[`hero-${mode}.svg`] = hero(s, mode); out[`rules-by-area-${mode}.svg`] = byArea(s, mode); out[`built-on-${mode}.svg`] = builtOn(b, mode) }
  return out
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const files = render(), check = process.argv.includes('--check')
  const stale = Object.entries(files).filter(([f, svg]) => !existsSync(join(OUT, f)) || readFileSync(join(OUT, f), 'utf8') !== svg).map(([f]) => f)
  if (check) { for (const f of stale) console.error(`✗ docs/img/${f} is out of date — run node bin/readme-visuals.mjs`); console.log(`readme visuals: ${Object.keys(files).length} file(s), ${stale.length} stale`); process.exit(stale.length ? 1 : 0) }
  mkdirSync(OUT, { recursive: true }); for (const [f, svg] of Object.entries(files)) writeFileSync(join(OUT, f), svg)
  console.log(`wrote ${Object.keys(files).length} SVG(s) to docs/img/ (${stale.length} changed)`)
}

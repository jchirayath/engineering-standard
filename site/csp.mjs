#!/usr/bin/env node
// Derive and verify a site's Content-Security-Policy from its OWN files (WEB-3). Zero deps.
//   node csp.mjs suggest <publish-dir>   → prints a CSP for the header config
//   node csp.mjs verify  <publish-dir> [--config <header file>] [--csp "<policy>"]   → exit 1 if the policy misses anything
// Inline <script> blocks get sha256 hashes; inline on*= handlers get hashes + 'unsafe-hashes' (move them to files
// to drop that). External origins are collected per directive. GA4 / Google Fonts origins are added when used.
// verify runs in check-build.mjs, so editing an inline script without updating the CSP fails the deploy
// instead of silently breaking the page in production.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const [mode, dirArg, ...rest] = process.argv.slice(2)
const flag = (n) => rest.includes(n) ? rest[rest.indexOf(n) + 1] : undefined
if (!['suggest', 'verify'].includes(mode) || !dirArg) { console.error('usage: csp.mjs suggest|verify <publish-dir> [--config file] [--csp policy]'); process.exit(2) }
// Absolute URLs to the site's own host are listed explicitly: a site served on both apex and www loads them cross-origin.
const dir = resolve(dirArg)

const SKIP = new Set(['.git', 'node_modules', '.well-known'])
const walk = (d, out = []) => { for (const e of readdirSync(d)) { if (SKIP.has(e)) continue; const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : out.push(p) } return out }
const files = walk(dir)
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&')
const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`
const need = { 'script-src': new Set(), 'style-src': new Set(), 'img-src': new Set(), 'font-src': new Set(), 'connect-src': new Set(), 'frame-src': new Set(), 'media-src': new Set(), 'form-action': new Set() }
const notes = []
let handlers = 0, inlineStyles = false, usesGA = false, usesFonts = false, dynamicInline = 0
const origin = (u, base) => { try { const x = new URL(u, base); return x.protocol.startsWith('http') && x.host ? `https://${x.host}` : null } catch { return null } }

for (const f of files) {
  const rel = relative(dir, f)
  if (/\.(js|mjs)$/.test(f)) {
    const js = readFileSync(f, 'utf8')
    if (/googletagmanager\.com\/gtag\/js|gtag\(/.test(js)) usesGA = true
    for (const m of js.matchAll(/\b(?:fetch|XMLHttpRequest[^;]*open)\s*\(\s*[`'"](https:\/\/[^/`'"]+)/g)) need['connect-src'].add(m[1])
    continue
  }
  if (/\.css$/.test(f)) { for (const m of readFileSync(f, 'utf8').matchAll(/url\(\s*['"]?(https:\/\/[^/'")]+)/g)) need['img-src'].add(m[1]); continue }
  if (!/\.(html?|php)$/i.test(f)) continue
  const html = readFileSync(f, 'utf8'), isPhp = /\.php$/i.test(f)
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const [, attrs, body] = m
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)/i)?.[1]
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)/i)?.[1]?.toLowerCase()
    if (src) { const o = origin(src, 'https://self.invalid/'); if (o && !o.endsWith('self.invalid')) need['script-src'].add(o); if (/googletagmanager|analytics\.js/.test(src)) usesGA = true; continue }
    if (type && !/javascript|module|^text\/babel$/.test(type)) continue          // JSON-LD, templates: not executed
    if (!body.trim()) continue
    if (isPhp && /<\?(php|=)/.test(body)) { dynamicInline++; notes.push(`${rel}: inline script contains PHP output — hash changes per request; move it to a file or use a nonce`); continue }
    need['script-src'].add(sha(body))
    if (/gtag\(|googletagmanager/.test(body)) usesGA = true
  }
  for (const m of html.matchAll(/\s(on[a-z]+)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    if (!/^on[a-z]+$/i.test(m[1]) || /^on(e|ly)$/i.test(m[1])) continue
    need['script-src'].add(sha(decode(m[3] ?? m[4]))); handlers++
  }
  if (/\shref\s*=\s*["']javascript:/i.test(html)) notes.push(`${rel}: javascript: URL — blocked by CSP; replace with a button + listener`)
  if (/<style\b|\sstyle\s*=/i.test(html)) inlineStyles = true
  for (const m of html.matchAll(/<(link|img|iframe|source|video|audio|form|embed)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase(), a = m[2]
    const url = a.match(/\b(?:src|href|action|srcset)\s*=\s*["']([^"'\s]+)/i)?.[1]
    if (!url) continue
    const o = origin(url, 'https://self.invalid/'); if (!o || o.endsWith('self.invalid')) continue
    if (tag === 'link') {
      const r = a.match(/\brel\s*=\s*["']([^"']+)/i)?.[1] || ''
      if (/stylesheet/.test(r) || /\bas\s*=\s*["']style/.test(a)) need['style-src'].add(o)
      else if (/icon/.test(r)) need['img-src'].add(o)
      else if (/\bas\s*=\s*["']font/.test(a)) need['font-src'].add(o)
      else if (/\bas\s*=\s*["']script/.test(a)) need['script-src'].add(o)
      if (/fonts\.googleapis\.com/.test(o)) usesFonts = true
    } else if (tag === 'img') need['img-src'].add(o)
    else if (tag === 'iframe' || tag === 'embed') need['frame-src'].add(o)
    else if (tag === 'form') need['form-action'].add(o)
    else need['media-src'].add(o)
  }
}
// Fixed companions of well-known providers.
if (usesGA) {
  need['script-src'].add('https://www.googletagmanager.com')
  for (const o of ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com']) need['connect-src'].add(o)
  for (const o of ['https://*.google-analytics.com', 'https://*.googletagmanager.com']) need['img-src'].add(o)
}
if (usesFonts) { need['style-src'].add('https://fonts.googleapis.com'); need['font-src'].add('https://fonts.gstatic.com') }
need['style-src'].delete('https://fonts.gstatic.com')
if (need['frame-src'].has('https://www.youtube.com')) need['frame-src'].add('https://www.youtube-nocookie.com')

const sorted = (s) => [...s].sort((a, b) => (a.startsWith("'") - b.startsWith("'")) || a.localeCompare(b))
function build() {
  const d = []
  d.push("default-src 'self'")
  d.push(['script-src', "'self'", ...sorted(need['script-src']), ...(handlers ? ["'unsafe-hashes'"] : [])].join(' '))
  d.push(['style-src', "'self'", ...(inlineStyles ? ["'unsafe-inline'"] : []), ...sorted(need['style-src'])].join(' '))
  d.push(['img-src', "'self'", 'data:', ...sorted(need['img-src'])].join(' '))
  d.push(['font-src', "'self'", ...sorted(need['font-src'])].join(' '))
  d.push(['connect-src', "'self'", ...sorted(need['connect-src'])].join(' '))
  if (need['frame-src'].size) d.push(['frame-src', ...sorted(need['frame-src'])].join(' '))
  if (need['media-src'].size) d.push(['media-src', "'self'", ...sorted(need['media-src'])].join(' '))
  d.push("object-src 'none'", "base-uri 'none'", ['form-action', "'self'", ...sorted(need['form-action'])].join(' '), "frame-ancestors 'none'", 'upgrade-insecure-requests')
  return d.join('; ')
}

if (mode === 'suggest') {
  for (const n of notes) console.error(`⚠ ${n}`)
  const hashes = [...need['script-src']].filter(s => s.startsWith("'sha")).length
  console.error(`# ${files.length} files · ${hashes} script hashes (${handlers} inline handlers${handlers ? " → 'unsafe-hashes'" : ''}) · GA4: ${usesGA ? 'yes' : 'NO'} · ${dynamicInline} dynamic inline scripts`)
  console.log(build())
  process.exit(0)
}

// verify: find the policy in the header config and check it covers everything the files need.
let policy = flag('--csp')
if (!policy) {
  const cands = [flag('--config'), 'staticwebapp.config.json', 'netlify.toml', '_headers', '.htaccess'].filter(Boolean)
  const roots = [dir, dirname(dir), process.cwd()]
  search: for (const c of cands) for (const r of roots) {
    const p = resolve(r, c); if (!existsSync(p)) continue
    const t = readFileSync(p, 'utf8')
    const m = t.match(/"Content-Security-Policy(?:-Report-Only)?"\s*:\s*"([^"]+)"/) || t.match(/Content-Security-Policy(?:-Report-Only)?\s*[=:]\s*"([^"]+)"/) || t.match(/Content-Security-Policy(?:-Report-Only)?:\s*(.+)$/m) || t.match(/Header\s+always\s+set\s+Content-Security-Policy(?:-Report-Only)?\s+"([^"]+)"/)
    if (m) { policy = m[1]; console.error(`# policy from ${relative(process.cwd(), p)}`); break search }
  }
  if (!policy) { console.log('– no Content-Security-Policy found in a header config; CSP verify skipped'); process.exit(0) }
}
const have = Object.fromEntries(policy.split(';').map(s => s.trim()).filter(Boolean).map(s => { const [k, ...v] = s.split(/\s+/); return [k.toLowerCase(), new Set(v)] }))
const allows = (dirName, src) => {
  const set = have[dirName] || (['frame-src', 'media-src', 'font-src', 'img-src', 'connect-src', 'script-src', 'style-src'].includes(dirName) ? have['default-src'] : undefined)
  if (!set) return dirName === 'form-action'
  if (set.has(src) || set.has("'unsafe-inline'") && src.startsWith("'sha") && !set.has("'strict-dynamic'")) return true
  return [...set].some(s => s.includes('*') && new RegExp('^' + s.replace(/[.]/g, '\\.').replace(/\*/g, '[^.]+') + '$').test(src))
}
const missing = []
for (const [d, srcs] of Object.entries(need)) for (const s of srcs) if (!allows(d, s)) missing.push(`${d} ${s}`)
if (handlers && !have['script-src']?.has("'unsafe-hashes'") && !have['script-src']?.has("'unsafe-inline'")) missing.push("script-src 'unsafe-hashes' (inline on*= handlers)")
for (const n of notes) console.warn(`⚠ ${n}`)
for (const m of missing) console.log(`✗ CSP does not allow: ${m}`)
console.log(`${missing.length ? '✗' : '✓'} CSP covers ${files.length} files${missing.length ? ` — ${missing.length} missing (run: csp.mjs suggest ${dirArg})` : ''}`)
process.exit(missing.length ? 1 : 0)

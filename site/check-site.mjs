#!/usr/bin/env node
// Post-deploy security check of a LIVE website (ENGINEERING_STANDARD §2A, WEB-*). Read-only GETs. Zero deps.
//   node check-site.mjs https://example.com [https://www.example.com ...] [--forbid /admin.html ...] [--json]
//   node check-site.mjs --config site.config.json
// site.config.json: { "urls": [...], "forbid": ["/admin.html"], "allowExternalScripts": ["www.googletagmanager.com"] }
// Exit 1 if any ERROR. WARN = should fix; INFO = context.
import tls from 'node:tls'
import dns from 'node:dns/promises'
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const opt = { urls: [], forbid: [], allowExternalScripts: ['www.googletagmanager.com', 'www.google-analytics.com', 'fonts.googleapis.com'], json: false }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--json') opt.json = true
  else if (a === '--forbid') opt.forbid.push(argv[++i])
  else if (a === '--config') {
    const raw = JSON.parse(readFileSync(argv[++i], 'utf8')), c = raw.site || raw   // standard.config.json {site:{…}} or a bare {urls,…}
    opt.urls.push(...(c.urls || [])); opt.forbid.push(...(c.forbid || []))
    if (c.allowExternalScripts) opt.allowExternalScripts.push(...c.allowExternalScripts)
  }
  else opt.urls.push(a)
}
if (!opt.urls.length) { console.error('usage: check-site.mjs <https://site> [...] [--forbid /path] [--json] | --config site.config.json'); process.exit(2) }

const UA = 'engineering-standard-site-check/1.0'
const get = async (url, init = {}) => {
  try {
    const r = await fetch(url, { redirect: 'follow', ...init, headers: { 'user-agent': UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(15000) })
    const buf = Buffer.from(await r.arrayBuffer())
    return { status: r.status, headers: r.headers, body: buf.toString('utf8'), raw: buf, url: r.url }
  } catch (e) { return { status: 0, headers: new Headers(), body: '', raw: Buffer.alloc(0), error: e.cause?.code || e.name } }
}
const tlsInfo = (host) => new Promise((res) => {
  const s = tls.connect({ host, port: 443, servername: host, timeout: 10000 }, () => {
    const c = s.getPeerCertificate(); res({ authorized: s.authorized, error: s.authorizationError, protocol: s.getProtocol(), validTo: c.valid_to, issuer: c.issuer?.O }); s.end()
  })
  s.on('error', (e) => res({ authorized: false, error: e.code || e.message })); s.on('timeout', () => { s.destroy(); res({ authorized: false, error: 'timeout' }) })
})

// Files that must never be served. Each has a signature so an SPA/soft-404 fallback page isn't counted as exposure.
const PROBES = [
  ['/.git/HEAD', b => /^ref: refs\//.test(b)], ['/.git/config', b => /\[core\]/.test(b)],
  ['/.env', b => /^[A-Z][A-Z0-9_]+=/m.test(b)], ['/.env.local', b => /^[A-Z][A-Z0-9_]+=/m.test(b)], ['/.env.production', b => /^[A-Z][A-Z0-9_]+=/m.test(b)],
  ['/.DS_Store', (b, raw) => raw.subarray(4, 8).toString('latin1') === 'Bud1'],
  ['/.htaccess', b => /RewriteEngine|<IfModule|Header set/i.test(b)], ['/.htpasswd', b => /^\w+:\$?[\w./$]+/m.test(b)],
  ['/package.json', b => /"(dependencies|scripts)"\s*:/.test(b)], ['/composer.json', b => /"require"\s*:/.test(b)],
  ['/server.js', b => /require\(|createServer|express\(/.test(b)], ['/wp-config.php.bak', b => /DB_PASSWORD/.test(b)],
  ['/wp-config.php~', b => /DB_PASSWORD/.test(b)], ['/config.php.bak', b => /<\?php/.test(b)], ['/phpinfo.php', b => /phpinfo\(\)|PHP Version/.test(b)],
  ['/backup.zip', (b, raw, h) => /zip|octet-stream/.test(h.get('content-type') || '') && raw.length > 100],
  ['/.vscode/settings.json', b => /^\s*\{/.test(b) && /"[\w.]+"\s*:/.test(b)], ['/docker-compose.yml', b => /services:/.test(b)],
]

async function checkSite(url) {
  const u = new URL(url), host = u.hostname, findings = []
  const add = (level, id, msg) => findings.push({ level, id, msg })

  // 1. HTTPS redirect + TLS
  const plain = await get(`http://${host}${u.pathname}`, { redirect: 'manual' })
  const loc = plain.headers.get('location') || ''
  if (plain.status === 0) add('INFO', 'WEB-2', `http:// not reachable (${plain.error}) — fine if port 80 is closed`)
  else if (![301, 308].includes(plain.status) || !loc.startsWith('https://')) add('ERROR', 'WEB-2', `http:// returns ${plain.status}${loc ? ' → ' + loc : ''}; expected 301/308 to https://`)
  const t = await tlsInfo(host)
  if (!t.authorized) add('ERROR', 'WEB-2', `TLS certificate not valid: ${t.error}`)
  else {
    const days = Math.floor((new Date(t.validTo) - Date.now()) / 864e5)
    if (days < 14) add('ERROR', 'WEB-2', `certificate expires in ${days} days`); else if (days < 30) add('WARN', 'WEB-2', `certificate expires in ${days} days`)
    if (!['TLSv1.2', 'TLSv1.3'].includes(t.protocol)) add('ERROR', 'WEB-2', `negotiated ${t.protocol}`)
  }

  // 2. Page + headers
  const page = await get(url)
  if (page.status !== 200) { add('ERROR', 'WEB-1', `GET ${url} → ${page.status || page.error}`); return { url, findings } }
  const h = (n) => page.headers.get(n) || ''
  const hsts = h('strict-transport-security'), maxAge = +(hsts.match(/max-age=(\d+)/)?.[1] || 0)
  if (!hsts) add('ERROR', 'WEB-3', 'missing Strict-Transport-Security')
  else if (maxAge < 15552000) add('WARN', 'WEB-3', `HSTS max-age=${maxAge} (< 180 days)`)
  else if (!/includeSubDomains/i.test(hsts)) add('INFO', 'WEB-3', 'HSTS without includeSubDomains')
  const csp = h('content-security-policy')
  if (!csp) add(h('content-security-policy-report-only') ? 'WARN' : 'ERROR', 'WEB-3', h('content-security-policy-report-only') ? 'CSP is report-only — enforce it' : 'missing Content-Security-Policy')
  else {
    const dir = (d) => csp.match(new RegExp(`(?:^|;)\\s*${d}\\s+([^;]*)`, 'i'))?.[1] || ''
    const scriptSrc = dir('script-src') || dir('default-src')
    if (/'unsafe-inline'/.test(scriptSrc) && !/'nonce-|'sha(256|384|512)-|'strict-dynamic'/.test(scriptSrc)) add('ERROR', 'WEB-3', "CSP script-src allows 'unsafe-inline'")
    if (/'unsafe-eval'/.test(scriptSrc)) add('WARN', 'WEB-3', "CSP script-src allows 'unsafe-eval'")
    if (/(^|\s)(\*|https:|http:)(\s|$)/.test(scriptSrc)) add('ERROR', 'WEB-3', `CSP script-src is a wildcard: ${scriptSrc.trim()}`)
    if (!dir('object-src') && !/'none'/.test(dir('default-src'))) add('WARN', 'WEB-3', "CSP missing object-src 'none'")
    if (!dir('base-uri')) add('WARN', 'WEB-3', "CSP missing base-uri 'self'")
    if (!dir('frame-ancestors') && !/^(deny|sameorigin)$/i.test(h('x-frame-options'))) add('ERROR', 'WEB-3', 'no clickjacking protection (CSP frame-ancestors or X-Frame-Options)')
  }
  if (!csp && !/^(deny|sameorigin)$/i.test(h('x-frame-options'))) add('ERROR', 'WEB-3', 'no clickjacking protection (CSP frame-ancestors or X-Frame-Options)')
  if (h('x-content-type-options').toLowerCase() !== 'nosniff') add('ERROR', 'WEB-3', 'missing X-Content-Type-Options: nosniff')
  if (!h('referrer-policy')) add('WARN', 'WEB-3', 'missing Referrer-Policy (use strict-origin-when-cross-origin)')
  if (!h('permissions-policy')) add('WARN', 'WEB-3', 'missing Permissions-Policy (deny camera, microphone, geolocation unless used)')
  for (const n of ['server', 'x-powered-by', 'x-aspnet-version']) if (/\d/.test(h(n))) add('WARN', 'WEB-3', `${n}: "${h(n)}" discloses a version`)
  for (const c of page.headers.getSetCookie?.() || []) {
    const name = c.split('=')[0]
    if (!/;\s*secure/i.test(c)) add('ERROR', 'WEB-4', `cookie ${name} without Secure`)
    if (/sess|auth|token|sid|jwt/i.test(name) && !/;\s*httponly/i.test(c)) add('ERROR', 'WEB-4', `session-like cookie ${name} without HttpOnly`)
    if (!/;\s*samesite=/i.test(c)) add('WARN', 'WEB-4', `cookie ${name} without SameSite`)
  }

  // 3. Content: mixed content, SRI, source maps, directory listing
  const html = page.body
  const tags = [...html.matchAll(/<(script|link|img|iframe|source|video|audio)\b[^>]*>/gi)].map(m => m[0])
  const attr = (tag, a) => tag.match(new RegExp(`\\b${a}\\s*=\\s*["']([^"']+)`, 'i'))?.[1]
  const scripts = []
  for (const tag of tags) {
    const kind = tag.match(/^<(\w+)/)[1].toLowerCase()
    const src = attr(tag, 'src') || (kind === 'link' && /stylesheet|preload|modulepreload/i.test(attr(tag, 'rel') || '') ? attr(tag, 'href') : null)
    if (!src) continue
    if (src.startsWith('http://')) add(['script', 'link', 'iframe'].includes(kind) ? 'ERROR' : 'WARN', 'WEB-5', `mixed content: <${kind}> ${src}`)
    let abs; try { abs = new URL(src, page.url) } catch { continue }
    if (kind === 'script') scripts.push(abs)
    if ((kind === 'script' || kind === 'link') && abs.host !== new URL(page.url).host && !attr(tag, 'integrity') && !opt.allowExternalScripts.includes(abs.host))
      add('WARN', 'WEB-6', `third-party <${kind}> without Subresource Integrity: ${abs.href}`)
  }
  for (const s of scripts.filter(s => s.host === new URL(page.url).host).slice(0, 10)) {
    const js = await get(s.href)
    const ref = js.body.match(/\/\/[#@]\s*sourceMappingURL=([^\s]+)\s*$/m)?.[1]
    const mapUrl = ref && !ref.startsWith('data:') ? new URL(ref, s).href : `${s.href}.map`
    const map = await get(mapUrl)
    if (map.status === 200 && /"mappings"\s*:/.test(map.body)) add('ERROR', 'WEB-7', `source map is public: ${mapUrl}`)
  }
  const dirs = [...new Set(tags.map(tg => attr(tg, 'src') || attr(tg, 'href')).filter(Boolean)
    .map(s => { try { const x = new URL(s, page.url); return x.host === new URL(page.url).host ? x.pathname.replace(/[^/]*$/, '') : null } catch { return null } })
    .filter(p => p && p !== '/'))].slice(0, 5)
  for (const d of dirs) {
    const r = await get(new URL(d, page.url).href)
    if (r.status === 200 && /<title>\s*(Index of|Directory listing)|<h1>Index of/i.test(r.body)) add('ERROR', 'WEB-8', `directory listing enabled at ${d}`)
  }

  // 4. Files that must not be public (signature match, so SPA fallbacks don't false-positive)
  const home = html.trim()
  for (const [p, sig] of PROBES) {
    const r = await get(new URL(p, page.url).href, { redirect: 'manual' })
    if (r.status === 200 && r.body.trim() !== home && sig(r.body, r.raw, r.headers)) add('ERROR', 'WEB-8', `exposed: ${p}`)
  }
  for (const p of opt.forbid) {
    const r = await get(new URL(p, page.url).href, { redirect: 'manual' })
    if (r.status === 200 && r.body.trim() !== home) add('ERROR', 'WEB-8', `forbidden path is public: ${p} (${r.status})`)
  }

  // 5. Disclosure + DNS hygiene
  const sec = await get(new URL('/.well-known/security.txt', page.url).href)
  if (!(sec.status === 200 && /^Contact:/mi.test(sec.body))) add('WARN', 'WEB-9', 'no /.well-known/security.txt with a Contact:')
  const apex = host.split('.').slice(-2).join('.')
  const caa = await dns.resolveCaa(apex).catch(() => [])
  if (!caa.length) add('WARN', 'WEB-10', `no CAA record on ${apex} (limit which CAs may issue certs)`)
  const txt = (await dns.resolveTxt(apex).catch(() => [])).map(r => r.join(''))
  if (!txt.some(r => r.startsWith('v=spf1'))) add('WARN', 'WEB-10', `no SPF record on ${apex} (add "v=spf1 -all" if it sends no mail)`)
  const dmarc = (await dns.resolveTxt(`_dmarc.${apex}`).catch(() => [])).map(r => r.join(''))
  if (!dmarc.some(r => r.startsWith('v=DMARC1'))) add('WARN', 'WEB-10', `no DMARC record on _dmarc.${apex}`)
  else if (dmarc.some(r => /p=none/.test(r))) add('INFO', 'WEB-10', `DMARC is p=none on ${apex} (monitor only)`)

  return { url, tls: t.authorized ? `${t.protocol}, ${t.issuer}, expires ${t.validTo}` : t.error, findings }
}

const results = []
for (const url of opt.urls) results.push(await checkSite(url))
if (opt.json) console.log(JSON.stringify(results, null, 2))
else for (const r of results) {
  const e = r.findings.filter(f => f.level === 'ERROR').length, w = r.findings.filter(f => f.level === 'WARN').length
  console.log(`\n${e ? '✗' : '✓'} ${r.url}  — ${e} errors, ${w} warnings${r.tls ? `  [${r.tls}]` : ''}`)
  for (const f of r.findings.sort((a, b) => ['ERROR', 'WARN', 'INFO'].indexOf(a.level) - ['ERROR', 'WARN', 'INFO'].indexOf(b.level)))
    console.log(`  ${f.level.padEnd(5)} ${f.id.padEnd(6)} ${f.msg}`)
}
process.exit(results.some(r => r.findings.some(f => f.level === 'ERROR')) ? 1 : 0)

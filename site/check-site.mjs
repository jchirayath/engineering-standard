#!/usr/bin/env node
// Live website check (ENGINEERING_STANDARD §2A, WEB-*). Read-only GETs; zero dependencies.
//   node check-site.mjs https://example.com [...] [--forbid /admin.html] [--ga G-XXXX] [--require-ga] [--max-pages 25] [--json]
//   node check-site.mjs --config standard.config.json        (its "site" block)  |  --config sites.json  ({ "sites": [...] })
// Categories: transport · headers · exposure · vulnerability · analytics · content · quality · dns
// Every finding carries a "fix". Most header/exposure fixes are applied by:  node harden.mjs <site-repo> --host <host>
// Exit 1 if any ERROR. External lookups: OSV.dev (library CVEs), endoflife.date (PHP), api.wordpress.org,
// rdap.org (domain expiry) — only package names/versions and the domain are sent.
import tls from 'node:tls'
import dns from 'node:dns/promises'
import { readFileSync } from 'node:fs'

// ── options ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const DEFAULT_ALLOW_EXT = ['www.googletagmanager.com', 'www.google-analytics.com', 'fonts.googleapis.com']
const sites = []
const cli = { forbid: [], ga: null, requireGa: false, maxPages: 25, json: false, urls: [] }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--json') cli.json = true
  else if (a === '--forbid') cli.forbid.push(argv[++i])
  else if (a === '--ga') { cli.ga = argv[++i]; cli.requireGa = true }
  else if (a === '--require-ga') cli.requireGa = true
  else if (a === '--max-pages') cli.maxPages = +argv[++i]
  else if (a === '--config') {
    const raw = JSON.parse(readFileSync(argv[++i], 'utf8'))
    for (const s of raw.sites || [raw.site || raw]) for (const url of s.urls || [s.url]) sites.push({ url, name: s.name, forbid: s.forbid || [],
      ga: s.analytics?.id || null, requireGa: s.analytics?.required ?? !!s.analytics?.id,
      allowExternalScripts: [...DEFAULT_ALLOW_EXT, ...(s.allowExternalScripts || [])], maxPages: s.maxPages || 25 })
  } else cli.urls.push(a)
}
for (const url of cli.urls) sites.push({ url, forbid: cli.forbid, ga: cli.ga, requireGa: cli.requireGa, allowExternalScripts: DEFAULT_ALLOW_EXT, maxPages: cli.maxPages })
if (!sites.length) { console.error('usage: check-site.mjs <https://site> [...] [--forbid /p] [--ga G-XXXX] [--require-ga] [--json] | --config file'); process.exit(2) }

// ── helpers ─────────────────────────────────────────────────────────────────
const UA = 'Mozilla/5.0 (compatible; engineering-standard-site-check/2.0)'
const cache = new Map()
async function get(url, init = {}) {
  const key = init.method || init.redirect || init.headers ? null : url
  if (key && cache.has(key)) return cache.get(key)
  const p = (async () => {
    const t0 = Date.now()
    try {
      const r = await fetch(url, { redirect: 'follow', ...init, headers: { 'user-agent': UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) })
      const buf = Buffer.from(await r.arrayBuffer())
      return { status: r.status, headers: r.headers, body: buf.toString('utf8'), raw: buf, url: r.url, ms: Date.now() - t0 }
    } catch (e) { return { status: 0, headers: new Headers(), body: '', raw: Buffer.alloc(0), url, error: e.cause?.code || e.name, ms: Date.now() - t0 } }
  })()
  if (key) cache.set(key, p)
  return p
}
const getJson = async (url, init) => { const r = await get(url, init); try { return r.status === 200 ? JSON.parse(r.body) : null } catch { return null } }
const tlsProbe = (host, opts = {}) => new Promise((res) => {
  const s = tls.connect({ host, port: 443, servername: host, timeout: 10000, ...opts }, () => {
    const c = s.getPeerCertificate(); res({ ok: true, authorized: s.authorized, error: s.authorizationError, protocol: s.getProtocol(), validTo: c.valid_to, issuer: c.issuer?.O }); s.end()
  })
  s.on('error', (e) => res({ ok: false, error: e.code || e.message })); s.on('timeout', () => { s.destroy(); res({ ok: false, error: 'timeout' }) })
})
const attr = (tag, a) => tag.match(new RegExp(`\\b${a}\\s*=\\s*["']([^"']*)`, 'i'))?.[1]
const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0 }
const apexOf = (h) => h.split('.').slice(-2).join('.')
const HARDEN = 'run harden.mjs on the site repo, then redeploy'

// Known JS libraries → npm names (for OSV). URL patterns + file banners.
const LIBS = { jquery: 'jquery', 'jquery-ui': 'jquery-ui', bootstrap: 'bootstrap', angular: 'angular', angularjs: 'angular', vue: 'vue', react: 'react',
  'react-dom': 'react-dom', lodash: 'lodash', underscore: 'underscore', moment: 'moment', handlebars: 'handlebars', dompurify: 'dompurify', swiper: 'swiper',
  axios: 'axios', knockout: 'knockout', backbone: 'backbone', 'chart.js': 'chart.js', chart: 'chart.js', 'video.js': 'video.js', three: 'three', d3: 'd3',
  'highlight.js': 'highlight.js', prismjs: 'prismjs', marked: 'marked', 'pdfjs-dist': 'pdfjs-dist', alpinejs: 'alpinejs', htmx: 'htmx.org' }
const BANNERS = [[/jQuery UI - v(\d+\.\d+\.\d+)/, 'jquery-ui'], [/jQuery v(\d+\.\d+\.\d+)/, 'jquery'], [/jQuery JavaScript Library v(\d+\.\d+\.\d+)/, 'jquery'],
  [/Bootstrap v(\d+\.\d+\.\d+)/, 'bootstrap'], [/AngularJS v(\d+\.\d+\.\d+)/, 'angular'], [/Vue\.js v(\d+\.\d+\.\d+)/, 'vue'], [/@license React[^\n]*?v(\d+\.\d+\.\d+)/, 'react'],
  [/var VERSION\s*=\s*'(\d+\.\d+\.\d+)'[\s\S]{0,300}lodash/, 'lodash'], [/Underscore\.js (\d+\.\d+\.\d+)/, 'underscore'], [/DOMPurify (\d+\.\d+\.\d+)/, 'dompurify'],
  [/Handlebars v(\d+\.\d+\.\d+)/, 'handlebars'], [/Swiper (\d+\.\d+\.\d+)/, 'swiper'], [/axios v(\d+\.\d+\.\d+)/, 'axios'], [/Chart\.js v(\d+\.\d+\.\d+)/, 'chart.js'],
  [/Video\.js (\d+\.\d+\.\d+)/, 'video.js'], [/highlight\.js v?(\d+\.\d+\.\d+)/, 'highlight.js'], [/moment\.js[\s\S]{0,80}?version\s*:\s*(\d+\.\d+\.\d+)/, 'moment']]
function libsFromUrl(u) {
  const out = []
  let m = u.match(/(?:cdnjs\.cloudflare\.com\/ajax\/libs|cdn\.jsdelivr\.net\/npm|unpkg\.com)\/((?:@[\w.-]+\/)?[\w.-]+)[@/]v?(\d+\.\d+\.\d+)/)
  if (m) out.push([m[1], m[2]])
  m = u.match(/\/([a-z][\w.-]*?)[.-]v?(\d+\.\d+\.\d+)(?:\.min|\.slim(?:\.min)?|\.bundle(?:\.min)?)?\.js/i)
  if (m && LIBS[m[1].toLowerCase()]) out.push([m[1].toLowerCase(), m[2]])
  m = u.match(/\/(jquery|jquery-ui|bootstrap|swiper)[^/]*\.js\?ver=(\d+\.\d+\.\d+)/i)
  if (m) out.push([m[1].toLowerCase(), m[2]])
  return out.map(([n, v]) => [LIBS[n] || n, v])
}

// ── one site ────────────────────────────────────────────────────────────────
async function checkSite(cfg) {
  const u = new URL(cfg.url), host = u.hostname, findings = [], summary = {}
  const add = (level, cat, id, msg, fix) => findings.push({ level, cat, id, msg, fix })

  // transport
  const plain = await get(`http://${host}${u.pathname}`, { redirect: 'manual' })
  const loc = plain.headers.get('location') || ''
  if (plain.status === 0) add('INFO', 'transport', 'WEB-2', `http:// not reachable (${plain.error})`, 'fine if port 80 is closed on purpose')
  else if (![301, 308].includes(plain.status) || !loc.startsWith('https://'))
    add('ERROR', 'transport', 'WEB-2', `http:// returns ${plain.status}${loc ? ' → ' + loc : ''}; expected 301/308 to https://`, `${HARDEN} (adds the https redirect for Apache/Netlify; Caddy/SWA redirect automatically)`)
  const t = await tlsProbe(host)
  if (!t.ok || !t.authorized) add('ERROR', 'transport', 'WEB-2', `TLS certificate not valid: ${t.error}`, 'reissue the certificate (host-managed: re-bind the custom domain; Caddy: check ACME logs)')
  else {
    const days = Math.floor((new Date(t.validTo) - Date.now()) / 864e5)
    summary.tls = `${t.protocol}, ${t.issuer}, cert ${days}d`
    if (days < 30) add(days < 14 ? 'ERROR' : 'WARN', 'transport', 'WEB-2', `certificate expires in ${days} days`, 'check automatic renewal on the host')
    if (!['TLSv1.2', 'TLSv1.3'].includes(t.protocol)) add('ERROR', 'transport', 'WEB-2', `negotiated ${t.protocol}`, 'set minimum TLS 1.2 on the host')
  }
  // Handshake-only probe: does the server still ACCEPT TLS 1.0/1.1? No data is sent, so skipping cert validation here is safe.
  const legacy = await tlsProbe(host, { minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0', rejectUnauthorized: false })
  if (legacy.ok) add('ERROR', 'vulnerability', 'WEB-2', `server still accepts ${legacy.protocol}`, 'disable TLS 1.0/1.1 (cPanel: SSL/TLS → protocols; Caddy/nginx: protocols tls1.2 tls1.3)')

  const page = await get(cfg.url)
  if (page.status !== 200) { add('ERROR', 'transport', 'WEB-1', `GET ${cfg.url} → ${page.status || page.error}`, 'site is down or misconfigured'); return { url: cfg.url, name: cfg.name, summary, findings } }
  const base = new URL(page.url), h = (n) => page.headers.get(n) || ''
  summary.ms = page.ms
  if (page.ms > 1500) add('WARN', 'quality', 'PERF-1', `homepage took ${page.ms} ms`, 'enable caching/CDN; check server response time')
  const twin = host.startsWith('www.') ? host.slice(4) : `www.${host}`
  const tw = await get(`https://${twin}/`, { redirect: 'manual' })
  if (tw.status === 200) add('WARN', 'quality', 'WEB-2', `both ${host} and ${twin} serve 200`, `redirect ${twin} → ${host} (or the reverse) so there is one canonical host`)

  // headers
  const hsts = h('strict-transport-security'), maxAge = +(hsts.match(/max-age=(\d+)/)?.[1] || 0)
  if (!hsts) add('ERROR', 'headers', 'WEB-3', 'missing Strict-Transport-Security', HARDEN)
  else if (maxAge < 15552000) add('WARN', 'headers', 'WEB-3', `HSTS max-age=${maxAge} (< 180 days)`, `${HARDEN} (sets max-age=31536000; includeSubDomains)`)
  const cspHeader = h('content-security-policy'), cspRO = h('content-security-policy-report-only'), csp = cspHeader || cspRO
  const dir = (d) => csp.match(new RegExp(`(?:^|;)\\s*${d}\\s+([^;]*)`, 'i'))?.[1]
  if (!cspHeader) add(cspRO ? 'WARN' : 'ERROR', 'headers', 'WEB-3', cspRO ? 'CSP is report-only' : 'missing Content-Security-Policy',
    cspRO ? 'after a clean week, re-run harden.mjs with --enforce' : `${HARDEN} (computes the CSP from the site's own files, incl. inline-script hashes)`)
  if (csp) {
    const scriptSrc = dir('script-src') ?? dir('default-src') ?? ''
    if (/'unsafe-inline'/.test(scriptSrc) && !/'nonce-|'sha(256|384|512)-|'strict-dynamic'/.test(scriptSrc)) add('ERROR', 'headers', 'WEB-3', "CSP script-src allows 'unsafe-inline'", `${HARDEN} (replaces it with hashes)`)
    if (/'unsafe-eval'/.test(scriptSrc)) add('WARN', 'headers', 'WEB-3', "CSP script-src allows 'unsafe-eval'", 'remove eval-based code, then drop the keyword')
    if (/(^|\s)(\*|https:|http:)(\s|$)/.test(scriptSrc)) add('ERROR', 'headers', 'WEB-3', 'CSP script-src is a wildcard', HARDEN)
    if (dir('object-src') === undefined && !/'none'/.test(dir('default-src') || '')) add('WARN', 'headers', 'WEB-3', "CSP missing object-src 'none'", HARDEN)
    if (dir('base-uri') === undefined) add('WARN', 'headers', 'WEB-3', "CSP missing base-uri 'self'", HARDEN)
  }
  if (!(csp && dir('frame-ancestors') !== undefined) && !/^(deny|sameorigin)$/i.test(h('x-frame-options'))) add('ERROR', 'headers', 'WEB-3', 'no clickjacking protection', HARDEN)
  if (h('x-content-type-options').toLowerCase() !== 'nosniff') add('ERROR', 'headers', 'WEB-3', 'missing X-Content-Type-Options: nosniff', HARDEN)
  if (!h('referrer-policy')) add('WARN', 'headers', 'WEB-3', 'missing Referrer-Policy', HARDEN)
  if (!h('permissions-policy')) add('WARN', 'headers', 'WEB-3', 'missing Permissions-Policy', HARDEN)
  for (const n of ['server', 'x-powered-by', 'x-aspnet-version', 'x-generator']) if (/\d/.test(h(n))) add('WARN', 'headers', 'WEB-3', `${n}: "${h(n)}" discloses a version`, `${HARDEN} (unsets it where the host allows; PHP: expose_php = Off)`)
  for (const c of page.headers.getSetCookie?.() || []) {
    const name = c.split('=')[0]
    if (!/;\s*secure/i.test(c)) add('ERROR', 'headers', 'WEB-4', `cookie ${name} without Secure`, 'set Secure on the cookie where it is issued')
    if (/sess|auth|token|sid|jwt|wordpress_logged/i.test(name) && !/;\s*httponly/i.test(c)) add('ERROR', 'headers', 'WEB-4', `session-like cookie ${name} without HttpOnly`, 'set HttpOnly where it is issued')
    if (!/;\s*samesite=/i.test(c)) add('WARN', 'headers', 'WEB-4', `cookie ${name} without SameSite`, 'set SameSite=Lax (or Strict)')
  }
  if (!/br|gzip|zstd/.test(h('content-encoding')) && page.raw.length > 2000) add('WARN', 'quality', 'PERF-1', 'HTML served without compression', 'enable gzip/br on the host (Caddy: encode zstd gzip; Apache: mod_deflate — harden.mjs adds it)')
  const cors = await get(cfg.url, { headers: { origin: 'https://evil.example' } })
  if ((cors.headers.get('access-control-allow-origin') || '') === 'https://evil.example') {
    const cred = /true/i.test(cors.headers.get('access-control-allow-credentials') || '')
    add(cred ? 'ERROR' : 'WARN', 'vulnerability', 'SEC-14', `CORS reflects any Origin${cred ? ' with credentials' : ''}`, 'replace origin reflection with an explicit allow-list')
  }

  // crawl same-origin pages (BFS)
  const pages = new Map([[base.href.replace(/#.*$/, ''), page]]), queue = [base.href], seen = new Set(queue), broken = []
  const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp[34]|mov|docx?|xlsx?|pptx?|ico|xml|txt|json|css|js)$/i
  while (queue.length && pages.size < cfg.maxPages) {
    const from = queue.shift(), html = (pages.get(from) || await get(from)).body
    for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)/gi)) {
      let l; try { l = new URL(m[1], from) } catch { continue }
      if (l.host !== base.host || !/^https?:$/.test(l.protocol) || SKIP_EXT.test(l.pathname)) continue
      l.hash = ''; if (seen.has(l.href)) continue; seen.add(l.href)
      const r = await get(l.href)
      if (r.status >= 400 || r.status === 0) { broken.push(`${l.pathname} (${r.status || r.error}) ← ${new URL(from).pathname}`); continue }
      if (!/text\/html/.test(r.headers.get('content-type') || '')) continue
      pages.set(r.url.replace(/#.*$/, ''), r); queue.push(r.url)
      if (pages.size >= cfg.maxPages) break
    }
  }
  summary.pages = pages.size
  for (const b of broken.slice(0, 8)) add('WARN', 'quality', 'UX-1', `broken internal link: ${b}`, 'fix or remove the link')
  if (broken.length > 8) add('WARN', 'quality', 'UX-1', `…and ${broken.length - 8} more broken internal links`, 'run with --json for the full list')

  // per-page content, analytics, libraries
  const scriptCache = new Map()
  const fetchScript = (src) => { if (!scriptCache.has(src)) scriptCache.set(src, get(src).then(r => r.status === 200 ? r.body : '')); return scriptCache.get(src) }
  const gaIds = new Set(), libs = new Map(), noGa = [], noTitle = [], noDesc = [], noLang = [], noAlt = [], noindex = [], sameOriginScripts = new Set()
  let anyGa = false, privacyLink = false
  for (const [purl, p] of pages) {
    const html = p.body, path = new URL(purl).pathname
    let pageGa = /googletagmanager\.com\/gtag\/js|gtag\(\s*['"]config|google-analytics\.com\/analytics\.js/.test(html)
    for (const m of html.matchAll(/\b(G-[A-Z0-9]{6,12})\b/g)) gaIds.add(m[1])
    for (const tag of [...html.matchAll(/<(script|link|img|iframe|source)\b[^>]*>/gi)].map(m => m[0])) {
      const kind = tag.match(/^<(\w+)/)[1].toLowerCase()
      const src = attr(tag, 'src') || (kind === 'link' && /stylesheet|preload|modulepreload/i.test(attr(tag, 'rel') || '') ? attr(tag, 'href') : null)
      if (!src) continue
      if (src.startsWith('http://')) add(['script', 'link', 'iframe'].includes(kind) ? 'ERROR' : 'WARN', 'content', 'WEB-5', `mixed content on ${path}: <${kind}> ${src}`, 'change the URL to https:// (CSP upgrade-insecure-requests also helps)')
      let abs; try { abs = new URL(src, purl) } catch { continue }
      if (kind === 'script') {
        for (const [n, v] of libsFromUrl(abs.href)) libs.set(`${n}@${v}`, [n, v, abs.href])
        if (abs.host === base.host) {
          sameOriginScripts.add(abs.href)
          const js = await fetchScript(abs.href)
          if (/googletagmanager\.com\/gtag\/js|gtag\(/.test(js)) pageGa = true
          for (const m of js.matchAll(/\b(G-[A-Z0-9]{6,12})\b/g)) gaIds.add(m[1])
          const head = js.slice(0, 4000)
          for (const [re, n] of BANNERS) { const m = head.match(re); if (m) { libs.set(`${n}@${m[1]}`, [n, m[1], abs.href]); break } }
        }
      }
      if ((kind === 'script' || kind === 'link') && abs.host !== base.host && !attr(tag, 'integrity') && !cfg.allowExternalScripts.includes(abs.host))
        add('WARN', 'content', 'WEB-6', `third-party <${kind}> without SRI on ${path}: ${abs.host}${abs.pathname.slice(0, 50)}`, 'self-host it, or add integrity="sha384-…" crossorigin="anonymous" (pin the version)')
    }
    for (const m of html.matchAll(/\/wp-content\/plugins\/([\w-]+)\/[^"']*\?ver=([\d.]+)/g)) summary.wpPlugins = { ...(summary.wpPlugins || {}), [m[1]]: m[2] }
    if (pageGa) anyGa = true; else noGa.push(path)
    if (!/<title>\s*[^<\s]/i.test(html)) noTitle.push(path)
    if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}/i.test(html) && !/<meta[^>]+content=["'][^"']{10,}["'][^>]+name=["']description/i.test(html)) noDesc.push(path)
    if (!/<html[^>]*\blang=/i.test(html)) noLang.push(path)
    const missingAlt = (html.match(/<img\b[^>]*>/gi) || []).filter(i => !/\balt\s*=/.test(i)).length
    if (missingAlt) noAlt.push(`${path} (${missingAlt})`)
    if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html) || /noindex/i.test(p.headers.get('x-robots-tag') || '')) noindex.push(path)
    if (/<a\b[^>]*href=["'][^"']*privacy[^"']*["']/i.test(html)) privacyLink = true
  }
  const list = (a) => a.slice(0, 5).join(', ') + (a.length > 5 ? ` …+${a.length - 5}` : '')

  // analytics
  summary.ga = anyGa ? ([...gaIds].join(',') || 'tag found') : 'NONE'
  const gaFix = 'include the shared tag on every page: <script src="/analytics.js" defer></script> (~/web/sync-analytics.sh wires missing pages)'
  if (!anyGa) add(cfg.requireGa ? 'ERROR' : 'WARN', 'analytics', 'GA', `Google Analytics not found on any of ${pages.size} crawled page(s)`, gaFix)
  else {
    if (noGa.length) add(cfg.requireGa ? 'ERROR' : 'WARN', 'analytics', 'GA', `${noGa.length}/${pages.size} pages have no GA tag: ${list(noGa)}`, gaFix)
    if (cfg.ga && !gaIds.has(cfg.ga)) add('ERROR', 'analytics', 'GA', `expected measurement ID ${cfg.ga} not found (saw: ${[...gaIds].join(', ') || 'none'})`, 'map this hostname to the right property in analytics.js and re-sync')
    if (cspHeader) {
      const allows = (d, o) => (dir(d) ?? dir('default-src') ?? '').split(/\s+/).some(s => s === o || (s.includes('*') && new RegExp('^' + s.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$').test(o)))
      if (!allows('script-src', 'https://www.googletagmanager.com')) add('ERROR', 'analytics', 'GA', 'CSP blocks the GA4 tag (script-src)', `${HARDEN} (csp.mjs adds GA origins when it sees the tag)`)
      if (!allows('connect-src', 'https://region1.google-analytics.com')) add('ERROR', 'analytics', 'GA', 'CSP blocks GA4 hits (connect-src)', HARDEN)
    }
    if (!privacyLink) add('WARN', 'analytics', 'WEB-14', 'analytics is on but no privacy page is linked', 'add a /privacy page and link it from the footer')
  }

  // quality
  if (noTitle.length) add('WARN', 'quality', 'SEO', `missing <title>: ${list(noTitle)}`, 'add a descriptive <title>')
  if (noDesc.length) add('INFO', 'quality', 'SEO', `no meta description on ${noDesc.length}/${pages.size} pages: ${list(noDesc)}`, 'add <meta name="description" content="…">')
  if (noLang.length) add('WARN', 'quality', 'UX-5', `<html> without lang on ${noLang.length} page(s): ${list(noLang)}`, 'add <html lang="en">')
  if (noAlt.length) add('WARN', 'quality', 'UX-5', `<img> without alt: ${list(noAlt)}`, 'add alt text (alt="" for decorative images)')
  if (noindex.length) add('WARN', 'quality', 'SEO', `noindex on production pages: ${list(noindex)}`, 'remove noindex unless intentional')
  const robots = await get(new URL('/robots.txt', base).href)
  if (robots.status === 200 && /^User-agent:\s*\*[\s\S]*?^Disallow:\s*\/\s*$/mi.test(robots.body)) add('WARN', 'quality', 'SEO', 'robots.txt disallows everything', 'remove "Disallow: /" unless the site should be hidden')
  const sitemap = await get(new URL('/sitemap.xml', base).href)
  if (!(sitemap.status === 200 && /<(urlset|sitemapindex)/.test(sitemap.body)) && pages.size > 3) add('INFO', 'quality', 'SEO', 'no /sitemap.xml', 'generate a sitemap at build time')

  // exposure (signature-matched, so SPA/soft-404 fallbacks don't count)
  const home = page.body.trim()
  const PROBES = [
    ['/.git/HEAD', b => /^ref: refs\//.test(b)], ['/.git/config', b => /\[core\]/.test(b)],
    ['/.env', b => /^[A-Z][A-Z0-9_]+=/m.test(b)], ['/.env.local', b => /^[A-Z][A-Z0-9_]+=/m.test(b)], ['/.env.production', b => /^[A-Z][A-Z0-9_]+=/m.test(b)],
    ['/.DS_Store', (b, raw) => raw.subarray(4, 8).toString('latin1') === 'Bud1'], ['/.htaccess', b => /RewriteEngine|<IfModule|Header set|DirectoryIndex|Options /i.test(b)],
    ['/.htpasswd', b => /^\w+:\$?[\w./$]+/m.test(b)], ['/package.json', b => /"(dependencies|scripts)"\s*:/.test(b)], ['/composer.json', b => /"require"\s*:/.test(b)],
    ['/server.js', b => /require\(|createServer|express\(/.test(b)], ['/wp-config.php.bak', b => /DB_PASSWORD/.test(b)], ['/wp-config.php~', b => /DB_PASSWORD/.test(b)],
    ['/config.php.bak', b => /<\?php/.test(b)], ['/phpinfo.php', b => /phpinfo\(\)|PHP Version/.test(b)], ['/info.php', b => /phpinfo\(\)|PHP Version/.test(b)],
    ['/backup.zip', (b, raw, hh) => /zip|octet-stream/.test(hh.get('content-type') || '') && raw.length > 100], ['/docker-compose.yml', b => /services:/.test(b)],
    ['/phpmyadmin/', b => /phpMyAdmin/i.test(b)], ['/adminer.php', b => /Adminer/i.test(b)], ['/server-status', b => /Apache Server Status/i.test(b)],
    ['/.vscode/settings.json', b => /^\s*\{/.test(b) && /"[\w.]+"\s*:/.test(b)], ['/Caddyfile', b => /reverse_proxy|file_server|php_fastcgi|root \*/.test(b)],
  ]
  await Promise.all(PROBES.map(async ([p, sig]) => {
    const r = await get(new URL(p, base).href, { redirect: 'manual' })
    if (r.status === 200 && r.body.trim() !== home && sig(r.body, r.raw, r.headers)) add('ERROR', 'exposure', 'WEB-8', `exposed: ${p}`, `stop shipping it (check-build.mjs blocks it) and block it at the server — ${HARDEN}`)
  }))
  for (const p of cfg.forbid) {
    const r = await get(new URL(p, base).href, { redirect: 'manual' })
    if (r.status === 200 && r.body.trim() !== home) add('ERROR', 'exposure', 'WEB-8', `forbidden path is public: ${p}`, 'remove it from the deploy allowlist (WEB-1)')
  }
  const dirs = [...new Set([...pages.values()].flatMap(p => [...p.body.matchAll(/(?:src|href)=["']([^"']+)/g)].map(m => { try { const x = new URL(m[1], base); return x.host === base.host ? x.pathname.replace(/[^/]*$/, '') : null } catch { return null } }))
    .filter(d => d && d !== '/'))].slice(0, 8)
  for (const d of dirs) { const r = await get(new URL(d, base).href); if (r.status === 200 && /<title>\s*(Index of|Directory listing)|<h1>Index of/i.test(r.body)) add('ERROR', 'exposure', 'WEB-8', `directory listing enabled at ${d}`, `${HARDEN} (Apache: Options -Indexes; nginx: autoindex off; Caddy: no "browse")`) }
  for (const s of [...sameOriginScripts].slice(0, 10)) {
    const js = await fetchScript(s), ref = js.match(/\/\/[#@]\s*sourceMappingURL=([^\s]+)\s*$/m)?.[1]
    const map = await get(ref && !ref.startsWith('data:') ? new URL(ref, s).href : `${s}.map`)
    if (map.status === 200 && /"mappings"\s*:/.test(map.body)) add('ERROR', 'exposure', 'WEB-7', `source map is public: ${new URL(s).pathname}.map`, 'build with sourcemaps off for production; check-build.mjs blocks *.map')
  }

  // vulnerabilities
  const libList = [...libs.values()]
  summary.libs = libList.map(([n, v]) => `${n}@${v}`).join(', ') || 'none detected'
  if (libList.length) {
    const res = await getJson('https://api.osv.dev/v1/querybatch', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: libList.map(([n, v]) => ({ package: { name: n, ecosystem: 'npm' }, version: v })) }) })
    if (!res) add('INFO', 'vulnerability', 'WEB-13', 'OSV lookup unavailable — library CVEs not checked', 're-run later')
    else for (const [i, r] of (res.results || []).entries()) {
      const ids = (r.vulns || []).map(v => v.id); if (!ids.length) continue
      const [n, v, src] = libList[i]
      const details = await Promise.all(ids.slice(0, 4).map(id => getJson(`https://api.osv.dev/v1/vulns/${id}`)))
      const cves = details.flatMap(d => (d?.aliases || []).filter(a => a.startsWith('CVE-'))).slice(0, 4)
      add('ERROR', 'vulnerability', 'WEB-13', `${n}@${v} has ${ids.length} known vulnerabilit${ids.length > 1 ? 'ies' : 'y'} (${(cves.length ? cves : ids.slice(0, 4)).join(', ')}) — ${new URL(src).pathname}`,
        `upgrade ${n} to the latest release (or remove it if unused) and self-host it`)
    }
  }
  const php = (h('x-powered-by') + ' ' + h('server')).match(/PHP\/(\d+\.\d+)(?:\.(\d+))?/)
  if (php) {
    const c = (await getJson('https://endoflife.date/api/php.json'))?.find(x => x.cycle === php[1])
    if (c?.eol && new Date(c.eol) < new Date()) add('ERROR', 'vulnerability', 'WEB-13', `PHP ${php[1]} is end-of-life since ${c.eol}`, 'upgrade PHP to a supported release on the host')
    else if (c?.latest && php[2] && cmpVer(`${php[1]}.${php[2]}`, c.latest) < 0) add('WARN', 'vulnerability', 'WEB-13', `PHP ${php[1]}.${php[2]} is behind ${c.latest}`, 'apply the PHP patch update')
  }
  if (/\/wp-content\/|\/wp-includes\/|<meta[^>]+generator[^>]+WordPress/i.test(page.body)) {
    const ver = page.body.match(/<meta[^>]+generator[^>]+WordPress\s+([\d.]+)/i)?.[1]
    const latest = (await getJson('https://api.wordpress.org/core/version-check/1.7/'))?.offers?.[0]?.current
    if (ver) add(latest && cmpVer(ver, latest) < 0 ? 'ERROR' : 'WARN', 'vulnerability', 'WEB-13', `WordPress ${ver} disclosed${latest && cmpVer(ver, latest) < 0 ? `, behind ${latest}` : ''}`, 'update core; remove the generator meta')
    if (/XML-RPC server accepts POST requests only/i.test((await get(new URL('/xmlrpc.php', base).href)).body)) add('WARN', 'vulnerability', 'WEB-13', 'WordPress XML-RPC enabled', 'disable xmlrpc.php')
    const users = await getJson(new URL('/wp-json/wp/v2/users', base).href)
    if (Array.isArray(users) && users.length) add('WARN', 'vulnerability', 'WEB-13', 'WordPress user enumeration via /wp-json/wp/v2/users', 'restrict the users REST endpoint')
    if (summary.wpPlugins) add('INFO', 'vulnerability', 'WEB-13', `WordPress plugins: ${Object.entries(summary.wpPlugins).map(([k, v]) => `${k}@${v}`).join(', ')}`, 'check each against WPScan/Wordfence')
  }

  // disclosure, DNS, domain
  const sec = await get(new URL('/.well-known/security.txt', base).href)
  if (!(sec.status === 200 && /^Contact:/mi.test(sec.body))) add('WARN', 'dns', 'WEB-9', 'no /.well-known/security.txt', `${HARDEN} (adds the file; check the Contact:)`)
  else { const exp = sec.body.match(/^Expires:\s*(.+)$/mi)?.[1]; if (exp && new Date(exp) < new Date()) add('WARN', 'dns', 'WEB-9', `security.txt expired ${exp.trim()}`, 'bump Expires:') }
  const apex = apexOf(host)
  if (!(await dns.resolveCaa(apex).catch(() => [])).length) add('WARN', 'dns', 'WEB-10', `no CAA record on ${apex}`, `add CAA: ${apex}. CAA 0 issue "letsencrypt.org" (+ "digicert.com" for Azure SWA)`)
  const txt = (await dns.resolveTxt(apex).catch(() => [])).map(r => r.join(''))
  if (!txt.some(r => r.startsWith('v=spf1'))) add('WARN', 'dns', 'WEB-10', `no SPF record on ${apex}`, 'add TXT "v=spf1 -all" if the domain sends no mail')
  const dmarc = (await dns.resolveTxt(`_dmarc.${apex}`).catch(() => [])).map(r => r.join(''))
  if (!dmarc.some(r => r.startsWith('v=DMARC1'))) add('WARN', 'dns', 'WEB-10', `no DMARC record on ${apex}`, `add TXT _dmarc.${apex} "v=DMARC1; p=reject"`)
  else if (dmarc.some(r => /p=none/.test(r))) add('INFO', 'dns', 'WEB-10', `DMARC p=none on ${apex}`, 'move to p=quarantine, then p=reject')
  const expiry = (await getJson(`https://rdap.org/domain/${apex}`))?.events?.find(e => e.eventAction === 'expiration')?.eventDate
  if (expiry) {
    const d = Math.floor((new Date(expiry) - Date.now()) / 864e5); summary.domain = `${d}d`
    if (d < 45) add(d < 7 ? 'ERROR' : 'WARN', 'dns', 'WEB-10', `domain ${apex} expires in ${d} days`, 'renew / confirm auto-renew at the registrar')
  }
  return { url: cfg.url, name: cfg.name, summary, findings }
}

// ── run (4 sites at a time) ─────────────────────────────────────────────────
const results = new Array(sites.length)
let next = 0
await Promise.all(Array.from({ length: Math.min(4, sites.length) }, async () => { while (next < sites.length) { const i = next++; results[i] = await checkSite(sites[i]) } }))
const ORDER = ['ERROR', 'WARN', 'INFO']
if (cli.json) console.log(JSON.stringify(results, null, 2))
else for (const r of results) {
  const n = (l) => r.findings.filter(f => f.level === l).length, s = r.summary
  console.log(`\n${n('ERROR') ? '✗' : '✓'} ${r.url}  — ${n('ERROR')} errors, ${n('WARN')} warnings`)
  console.log(`  ${[s.tls, s.ms && `${s.ms} ms`, s.pages && `${s.pages} pages`, s.ga && `GA: ${s.ga}`, s.libs && `libs: ${s.libs}`, s.domain && `domain renews in ${s.domain}`].filter(Boolean).join(' · ')}`)
  for (const f of r.findings.sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level) || a.cat.localeCompare(b.cat))) {
    console.log(`  ${f.level.padEnd(5)} ${f.cat.padEnd(13)} ${f.id.padEnd(6)} ${f.msg}`)
    if (f.fix && f.level !== 'INFO') console.log(`  ${' '.repeat(26)}↳ ${f.fix}`)
  }
}
process.exit(results.some(r => r.findings.some(f => f.level === 'ERROR')) ? 1 : 0)

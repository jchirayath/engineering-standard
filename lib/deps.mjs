// Dependency verification (SEC-31 slopsquatting, NPM-1/SUP-1 cooldown, OSV advisories). Zero deps, Node ≥ 20.
// Shared by the MCP tool verify_dependency and the PreToolUse(Bash) hook. Outbound calls only here.
export const COOLDOWN_DAYS = 7
export const ECOSYSTEMS = ['npm', 'pypi', 'pub', 'go']
const OSV_ECO = { npm: 'npm', pypi: 'PyPI', pub: 'Pub', go: 'Go' }

// Short popularity lists for the typosquat hint (edit distance 1–2 from one of these and not itself listed).
export const POPULAR = {
  npm: ['react', 'react-dom', 'next', 'vue', 'express', 'lodash', 'axios', 'typescript', 'webpack', 'vite', 'eslint', 'prettier',
    'jest', 'vitest', 'chalk', 'commander', 'dotenv', 'zod', 'moment', 'dayjs', 'uuid', 'debug', 'tailwindcss', 'postcss',
    'rxjs', 'redux', 'jsonwebtoken', 'bcrypt', 'mongoose', 'prisma', 'pino', 'winston', 'nodemon', 'cors', 'body-parser',
    'request', 'yargs', 'semver', 'glob', 'rimraf', 'ws', 'socket.io', 'graphql', 'openai', '@anthropic-ai/sdk', '@supabase/supabase-js', 'firebase'],
  pypi: ['requests', 'numpy', 'pandas', 'django', 'flask', 'fastapi', 'pydantic', 'boto3', 'urllib3', 'setuptools', 'six',
    'python-dateutil', 'pyyaml', 'cryptography', 'pytest', 'sqlalchemy', 'jinja2', 'click', 'httpx', 'aiohttp', 'scipy',
    'matplotlib', 'pillow', 'openai', 'anthropic', 'langchain', 'uvicorn', 'gunicorn', 'celery', 'redis', 'psycopg2', 'beautifulsoup4', 'selenium'],
  pub: ['http', 'provider', 'riverpod', 'flutter_riverpod', 'bloc', 'flutter_bloc', 'get', 'dio', 'shared_preferences', 'path_provider',
    'intl', 'url_launcher', 'firebase_core', 'firebase_auth', 'cloud_firestore', 'supabase_flutter', 'flutter_secure_storage',
    'go_router', 'freezed', 'json_serializable', 'equatable', 'image_picker', 'cached_network_image', 'sqflite', 'hive', 'uuid', 'logging', 'collection'],
  go: ['github.com/gin-gonic/gin', 'github.com/gorilla/mux', 'github.com/stretchr/testify', 'github.com/spf13/cobra', 'github.com/spf13/viper',
    'github.com/sirupsen/logrus', 'go.uber.org/zap', 'github.com/google/uuid', 'github.com/lib/pq', 'github.com/jackc/pgx/v5',
    'github.com/golang-jwt/jwt/v5', 'golang.org/x/crypto', 'golang.org/x/net', 'google.golang.org/grpc', 'github.com/labstack/echo/v4', 'github.com/go-chi/chi/v5'],
}

export function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}
const norm = (eco, n) => (eco === 'pypi' ? n.toLowerCase().replace(/[-_.]+/g, '-') : eco === 'go' ? n : n.toLowerCase())
export function typosquat(eco, name) {
  const list = (POPULAR[eco] || []).map((p) => norm(eco, p)), n = norm(eco, name)
  if (list.includes(n)) return []
  const max = n.length <= 4 ? 1 : 2
  return list.filter((p) => { const d = lev(n, p); return d >= 1 && d <= max })
}

const MAX_BYTES = 40 << 20
async function get(url, { timeoutMs, method = 'GET', body, accept = 'application/json' }) {
  const res = await fetch(url, { method, body, signal: AbortSignal.timeout(timeoutMs),
    headers: { accept, 'user-agent': 'engineering-standard-plugin', ...(body ? { 'content-type': 'application/json' } : {}) } })
  if (res.status === 404 || res.status === 410) return { status: 404 }
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`)
  // Bounded read: an oversized response is an error, not something to wait out (no fail-open by size).
  const reader = res.body.getReader(), chunks = []; let size = 0
  for (;;) {
    const { done, value } = await reader.read(); if (done) break
    size += value.length; if (size > MAX_BYTES) { reader.cancel().catch(() => {}); const e = new Error(`response over ${MAX_BYTES >> 20} MB`); e.name = 'OversizeError'; throw e }
    chunks.push(value)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return { status: res.status, json: accept.includes('json') ? JSON.parse(text) : null, text }
}

const goEsc = (p) => p.replace(/[A-Z]/g, (c) => '!' + c.toLowerCase())

// → { exists, version, publishedAt, deprecated }
async function registry(eco, name, version, timeoutMs) {
  if (eco === 'npm') {
    const r = await get(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, { timeoutMs })
    if (r.status === 404) return { exists: false }
    const j = r.json, v = version && j.versions?.[version] ? version : j['dist-tags']?.latest
    if (version && !j.versions?.[version]) return { exists: true, versionExists: false, version, latest: v }
    const history = Object.entries(j.time || {}).filter(([k]) => /^\d+\.\d+\.\d+$/.test(k) && !j.versions?.[k]?.deprecated).map(([v, t]) => ({ v, t }))
    return { exists: true, version: v, publishedAt: j.time?.[v], deprecated: j.versions?.[v]?.deprecated || null, history }
  }
  if (eco === 'pypi') {
    const r = await get(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, { timeoutMs })
    if (r.status === 404) return { exists: false }
    const j = r.json, v = version || j.info.version, files = j.releases?.[v]
    if (!files) return { exists: true, versionExists: false, version: v, latest: j.info.version }
    const inactive = (j.info.classifiers || []).some((c) => /Development Status :: 7/.test(c))
    const history = Object.entries(j.releases || {}).filter(([k, f]) => /^\d+(\.\d+)*$/.test(k) && f.length && !f.every((x) => x.yanked)).map(([v, f]) => ({ v, t: f[0].upload_time_iso_8601 }))
    return { exists: true, version: v, publishedAt: files[0]?.upload_time_iso_8601, history,
      deprecated: files.length && files.every((f) => f.yanked) ? `yanked: ${files[0].yanked_reason || ''}`.trim() : inactive ? 'Development Status :: 7 - Inactive' : null }
  }
  if (eco === 'pub') {
    const r = await get(`https://pub.dev/api/packages/${encodeURIComponent(name)}`, { timeoutMs })
    if (r.status === 404) return { exists: false }
    const j = r.json, v = version || j.latest?.version, e = j.versions?.find((x) => x.version === v)
    if (!e) return { exists: true, versionExists: false, version: v, latest: j.latest?.version }
    let deprecated = e.retracted ? 'retracted' : null
    try { const o = (await get(`https://pub.dev/api/packages/${encodeURIComponent(name)}/options`, { timeoutMs })).json
      if (o?.isDiscontinued) deprecated = `discontinued${o.replacedBy ? ` → ${o.replacedBy}` : ''}` } catch {}
    const history = (j.versions || []).filter((x) => /^\d+\.\d+\.\d+$/.test(x.version) && !x.retracted).map((x) => ({ v: x.version, t: x.published }))
    return { exists: true, version: v, publishedAt: e.published, deprecated, history }
  }
  if (eco === 'go') {
    const base = `https://proxy.golang.org/${goEsc(name)}/@`
    const r = await get(version ? `${base}v/${version}.info` : `${base}latest`, { timeoutMs })
    if (r.status === 404) return version ? { exists: true, versionExists: false, version } : { exists: false }
    const v = r.json.Version
    let deprecated = null
    try { const m = (await get(`${base}v/${v}.mod`, { timeoutMs, accept: 'text/plain' })).text
      const d = m?.match(/\/\/\s*Deprecated:\s*(.*)/); if (d) deprecated = d[1].trim() } catch {}
    return { exists: true, version: v, publishedAt: r.json.Time, deprecated }
  }
  throw new Error(`unsupported ecosystem ${eco} (npm|pypi|pub|go)`)
}

async function osv(eco, name, version, timeoutMs) {
  const body = JSON.stringify({ package: { name, ecosystem: OSV_ECO[eco] }, ...(version ? { version } : {}) })
  const r = await get('https://api.osv.dev/v1/query', { timeoutMs, method: 'POST', body })
  return (r.json?.vulns || []).map((v) => ({ id: v.id, aliases: v.aliases || [], summary: (v.summary || v.details || '').slice(0, 160),
    severity: v.database_specific?.severity || v.severity?.[0]?.score || null, malicious: /^MAL-/.test(v.id) }))
}

// verdict: 'ok' | 'warn' | 'block' | 'unknown' (network failure → unknown, callers fail open)
export async function verifyDependency({ ecosystem, name, version, security_fix = false, osv: withOsv = true, timeoutMs = 5000, now = Date.now() }) {
  const eco = String(ecosystem || '').toLowerCase()
  const out = { ecosystem: eco, name, requestedVersion: version || null, reasons: [], warnings: [], errors: [] }
  if (!ECOSYSTEMS.includes(eco)) return { ...out, verdict: 'unknown', errors: [`unsupported ecosystem "${ecosystem}" (npm|pypi|pub|go)`] }
  if (!name) return { ...out, verdict: 'unknown', errors: ['name is required'] }
  const similar = typosquat(eco, name)
  if (similar.length) { out.typosquat = similar; out.warnings.push(`name is 1–2 edits from popular ${similar.join(', ')} — confirm this is the intended package (SEC-31)`) }
  let reg
  try { reg = await registry(eco, name, version, timeoutMs) } catch (e) {
    // Offline (connection refused, DNS) → unknown, the hook warns and allows; CI re-checks. A timeout or an
    // oversized answer means the registry DID answer and we couldn't finish — that fails closed ('unverified').
    const slow = e.name === 'TimeoutError' || e.name === 'OversizeError'
    out.errors.push(`registry lookup failed: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`)
    return { ...out, verdict: slow ? 'unverified' : 'unknown' }
  }
  Object.assign(out, { exists: reg.exists })
  if (!reg.exists) { out.reasons.push(`${name} does not exist on the ${eco} registry — possible hallucinated/slopsquatted name (SEC-31)`); return { ...out, verdict: 'block' } }
  if (reg.versionExists === false) { out.reasons.push(`version ${reg.version} of ${name} does not exist (latest: ${reg.latest || '?'})`); return { ...out, latest: reg.latest, verdict: 'block' } }
  out.version = reg.version; out.publishedAt = reg.publishedAt || null; out.deprecated = reg.deprecated || null
  if (out.publishedAt) {
    out.ageDays = Math.floor((now - Date.parse(out.publishedAt)) / 864e5)
    const young = out.ageDays < COOLDOWN_DAYS
    out.cooldown = { days: COOLDOWN_DAYS, ok: !young, exempt: young && !!security_fix }
    if (young && !security_fix) {
      const cut = now - COOLDOWN_DAYS * 864e5
      const prev = (reg.history || []).filter((h) => Date.parse(h.t) <= cut).sort((a, b) => Date.parse(b.t) - Date.parse(a.t))[0]
      if (prev) out.suggest = prev.v
      out.reasons.push(`${name}@${out.version} was published ${out.ageDays} day(s) ago — inside the ${COOLDOWN_DAYS}-day cooldown (NPM-1/SUP-1); ${prev ? `pin ${name}@${prev.v} (newest version past the cooldown)` : 'pin an older version'}, or mark it a security fix (VULN-5)`)
    }
    if (young && security_fix) out.warnings.push(`inside the ${COOLDOWN_DAYS}-day cooldown but exempt as a declared security fix (VULN-5) — record why in the PR`)
  } else out.warnings.push('publish date unknown — cooldown not verified')
  if (out.deprecated) out.warnings.push(`deprecated: ${out.deprecated} (CLEAN-10: maintained dependencies only)`)
  if (withOsv) {
    try {
      out.advisories = await osv(eco, name, out.version, timeoutMs)
      if (out.advisories.some((a) => a.malicious)) out.reasons.push('OSV lists this package/version as MALICIOUS')
      else if (out.advisories.length) out.warnings.push(`${out.advisories.length} OSV advisory(ies) affect ${out.version}: ${out.advisories.slice(0, 5).map((a) => a.id).join(', ')} (SEC-15)`)
    } catch (e) { out.errors.push(`OSV lookup failed: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`) }
  }
  return { ...out, verdict: out.reasons.length ? 'block' : out.warnings.length ? 'warn' : 'ok' }
}

// Package specs named by an install command. → [{ ecosystem, name, version? }] — or { unverifiable } for a
// source the registry check can't vouch for (git/URL/file/alias/dist-tag), which the hook blocks.
// Segments: split on every shell separator, and also look inside $( … ), backticks and `sh -c "…"`.
// Quote-aware: separators inside '…' are literal; inside "…" only $( … ) and backticks start a sub-command.
function splitSegments(cmd) {
  const segs = []; let cur = '', q = null
  const flush = () => { if (cur.trim()) segs.push(cur); cur = '' }
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (q === "'") { cur += ch; if (ch === "'") q = null; continue }
    if (ch === '\\') { cur += ch + (cmd[i + 1] ?? ''); i++; continue }
    if (q === '"') {
      if (ch === '"') { q = null; cur += ch; continue }
      if (ch === '`' || (ch === '$' && cmd[i + 1] === '(')) { flush(); if (ch === '$') i++; continue }
      if (ch === ')') { flush(); continue }
      cur += ch; continue
    }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue }
    if (ch === '$' && cmd[i + 1] === '(') { flush(); i++; continue }
    if (';&|\n`()'.includes(ch)) { flush(); continue }
    cur += ch
  }
  flush(); return segs
}
export function commandSegments(command) {
  const out = []
  for (const seg of splitSegments(String(command))) {
    if (!seg.trim()) continue
    out.push(seg)
    const w = shellWords(seg), i = w.findIndex((x, k) => k > 0 && x === '-c' && /(^|\/)(ba|z|da|k)?sh$|^(env|eval)$/.test(w[0]))
    if (i > 0 && w[i + 1]) out.push(...commandSegments(w[i + 1]))
    else if (w[0] === 'eval') out.push(...commandSegments(w.slice(1).join(' ')))
  }
  return out
}
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nice', 'nohup', 'time', 'xargs', 'doas'])
// Word splitting as the shell does it: quotes, backslash escapes, $'…' ANSI-C strings ($'\x2eenv' = .env).
const ANSI = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"' }
export function shellWords(s) {
  const out = []; let cur = '', q = null, any = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q === "'") { if (ch === "'") q = null; else cur += ch; continue }
    if (q === '$') {
      if (ch === "'") { q = null; continue }
      if (ch === '\\') {
        const m = s.slice(i + 1).match(/^(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|[0-7]{1,3}|.)/s)[0]
        cur += /^[xu]/.test(m) ? String.fromCodePoint(parseInt(m.slice(1), 16)) : /^[0-7]/.test(m) ? String.fromCharCode(parseInt(m, 8)) : (ANSI[m] ?? m)
        i += m.length; continue
      }
      cur += ch; continue
    }
    if (q === '"') { if (ch === '"') q = null; else if (ch === '\\' && /["\\$`]/.test(s[i + 1] || '')) cur += s[++i]; else cur += ch; continue }
    if (ch === '\\') { if (s[i + 1] === '\n') i++; else if (i + 1 < s.length) { cur += s[++i]; any = true }; continue }
    if (ch === '$' && s[i + 1] === "'") { q = '$'; i++; any = true; continue }
    if (ch === '$' && s[i + 1] === '"') { q = '"'; i++; any = true; continue }
    if (ch === '"' || ch === "'") { q = ch; any = true; continue }
    if (/\s/.test(ch)) { if (cur || any) out.push(cur); cur = ''; any = false; continue }
    cur += ch
  }
  if (cur || any) out.push(cur)
  return out
}
// One level of brace expansion: .{env,x} → .env .x ; a{,.bak} → a a.bak. Used so `cat .{env,}` is caught.
export function expandBraces(t) {
  const m = t.match(/^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/)
  return m ? m[2].split(',').flatMap((x) => expandBraces(m[1] + x + m[3])) : [t]
}
const VALUE_FLAGS = new Set(['--registry', '--prefix', '-C', '--dir', '--filter', '-w', '--workspace', '--index-url', '-i', '--extra-index-url', '-c', '--constraint', '-t', '--target', '--python', '-p', '--group', '--optional', '--tag'])
export function installedPackages(command) {
  const found = []
  for (const seg of commandSegments(command)) {
    let w = shellWords(seg)
    for (;;) {                                                                     // VAR=value, sudo, env -i …
      if (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) { w = w.slice(1); continue }
      if (w.length && WRAPPERS.has(basename0(w[0]))) { w = w.slice(1); while (w[0]?.startsWith('-')) w = w.slice(1); continue }
      break
    }
    if (w.length) w = [basename0(w[0]), ...w.slice(1)]
    if (w[0] === 'corepack') w = w.slice(1)
    if (/^python[\d.]*$/.test(w[0])) { const m = w.indexOf('-m'); if (m > 0) w = w.slice(m + 1) }
    // Global flags may sit between the tool and its subcommand (`npm --global install x`, `pip -q install x`):
    // drop them (and the value of a value-flag) so `b`/`c` are the real subcommand words.
    w = [w[0], ...dropLeadingFlags(w.slice(1))]
    if (['flutter', 'dart', 'uv'].includes(w[0]) && w.length > 2) w = [w[0], w[1], ...dropLeadingFlags(w.slice(2))]
    let eco, args
    const [a, b, c] = w
    const npmBin = ['npm', 'pnpm', 'yarn', 'bun'].includes(a)
    if (npmBin && /^(i|in|ins|inst|insta|instal|install|isnt|isnta|isntal|isntall|add|a)$/.test(b || '')) [eco, args] = ['npm', w.slice(2)]
    else if (npmBin && b === 'global' && c === 'add') [eco, args] = ['npm', w.slice(3)]
    else if ((a === 'npx' || a === 'bunx') || (npmBin && ['dlx', 'exec', 'x'].includes(b))) {       // runs a package
      const rest = w.slice(a === 'npx' || a === 'bunx' ? 1 : 2)
      const p = rest.findIndex((x, k) => x === '-p' || x === '--package')
      const pkgs = p >= 0 ? [rest[p + 1]] : [rest.find((x) => !x.startsWith('-'))]
      ;[eco, args] = ['npm', pkgs.filter(Boolean).map((x) => x.replace(/^--package=/, ''))]
    }
    else if ((a === 'uvx') || (a === 'pipx' && ['install', 'run'].includes(b))) [eco, args] = ['pypi', [w.slice(a === 'uvx' ? 1 : 2).find((x) => !x.startsWith('-'))].filter(Boolean)]
    else if (/^pip[\d.]*$/.test(a) && b === 'install') [eco, args] = ['pypi', w.slice(2)]
    else if (a === 'uv' && b === 'add') [eco, args] = ['pypi', w.slice(2)]
    else if (a === 'uv' && b === 'pip' && c === 'install') [eco, args] = ['pypi', w.slice(3)]
    else if (a === 'poetry' && b === 'add') [eco, args] = ['pypi', w.slice(2)]
    else if (['flutter', 'dart'].includes(a) && b === 'pub' && c === 'add') [eco, args] = ['pub', w.slice(3)]
    else if (a === 'go' && (b === 'get' || b === 'install')) [eco, args] = ['go', w.slice(2)]
    else continue
    const altReg = w.find((x) => /^(--registry|--index-url|-i|--extra-index-url|--find-links|-f|--index|--default-index|--hosted-url)(=|$)/.test(x) || /^--@[\w-]+:registry=/.test(x))
    if (altReg && eco !== 'go') { found.push({ ecosystem: eco, name: w.slice(1).join(' '), unverifiable: `alternate registry/index (${altReg}) — the check queries the public registry, so it can't vouch for what this installs` }); continue }
    if (eco === 'go' && /GOPROXY=|GOFLAGS=.*-insecure|GONOSUMDB=|GOINSECURE=/.test(seg)) { found.push({ ecosystem: eco, name: seg.trim(), unverifiable: 'custom GOPROXY / checksum bypass' }); continue }
    for (let i = 0; i < args.length; i++) {
      const t = args[i]
      if (t.startsWith('-')) { if (VALUE_FLAGS.has(t) || (eco === 'pypi' && /^-(r|e)$|^--(requirement|editable)$/.test(t))) i++; continue }
      if (eco === 'pypi' && t === '@') { i++; found.push({ ecosystem: eco, name: args[i - 2] || t, unverifiable: `direct reference "${args[i] || ''}"` }); continue }
      if (/\{[^}]*,[^}]*\}|^\$|\$\{?\w/.test(t)) { found.push({ ecosystem: eco, name: t, unverifiable: 'shell expansion in a package name' }); continue }
      if (/^(workspace|link|portal|patch):|^\.{1,2}\//.test(t)) continue                 // local workspace/path: nothing downloaded
      if (/^[/~]|^(file|git|git\+\w+|npm|github|gitlab|bitbucket|gist|https?):|:\/\/|^[\w.-]+\/[\w.-]+(#.*)?$/.test(t) && eco !== 'go') {
        found.push({ ecosystem: eco, name: t, unverifiable: 'git/URL/file/alias source' }); continue }
      const s = spec(eco, t); if (s) found.push(s)
    }
  }
  return found
}
const basename0 = (x = '') => x.split('/').pop()
function dropLeadingFlags(ws) {
  let i = 0
  while (i < ws.length && ws[i].startsWith('-')) { if (VALUE_FLAGS.has(ws[i]) || ws[i] === '--cache' || ws[i] === '--userconfig') i++; i++ }
  return ws.slice(i)
}
const RANGE_MSG = (r) => `version range "${r}" — the package manager may install a release that wasn't checked; pin an exact version`
function spec(eco, t) {
  if (eco === 'npm') {
    const m = t.match(/^(@?[^@\s]+)(?:@(.+))?$/); if (!m) return { ecosystem: eco, name: t, unverifiable: 'unparseable spec' }
    const r = m[2]
    if (!r || r === 'latest' || /^\d+\.\d+\.\d+$/.test(r)) return { ecosystem: eco, name: m[1], version: r && /^\d+\.\d+\.\d+$/.test(r) ? r : undefined }
    if (/^\d+\.\d+\.\d+[-+][\w.+-]+$/.test(r)) return { ecosystem: eco, name: m[1], version: r }
    if (/^[\^~<>=*xX\d. |-]+$/.test(r)) return { ecosystem: eco, name: m[1], unverifiable: RANGE_MSG(r) }
    return { ecosystem: eco, name: m[1], unverifiable: `version spec "${r}" (alias, dist-tag or URL) — pin an exact registry version` }
  }
  if (eco === 'pypi') {
    const m = t.match(/^([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?\s*(.*)$/); if (!m) return { ecosystem: eco, name: t, unverifiable: 'unparseable spec' }
    const rest = m[2].replace(/;.*$/, '').trim()                                     // drop environment markers
    if (!rest) return { ecosystem: eco, name: m[1] }
    const ex = rest.match(/^===?\s*([\w.+!-]+)$/)
    return ex && !/\*/.test(ex[1]) ? { ecosystem: eco, name: m[1], version: ex[1] } : { ecosystem: eco, name: m[1], unverifiable: RANGE_MSG(rest) }
  }
  if (eco === 'pub') {
    const m = t.replace(/^(dev|override):/, '').match(/^([a-z0-9_]+)(?::\s*(.+))?$/); if (!m) return { ecosystem: eco, name: t, unverifiable: 'unparseable spec' }
    if (!m[2]) return { ecosystem: eco, name: m[1] }
    return /^\d+\.\d+\.\d+([-+][\w.+-]+)?$/.test(m[2]) ? { ecosystem: eco, name: m[1], version: m[2] } : { ecosystem: eco, name: m[1], unverifiable: RANGE_MSG(m[2]) }
  }
  if (eco === 'go') {
    if (/^\.\.\.$|^all$/.test(t)) return null; const [n, v] = t.split('@'); if (!n.includes('.')) return null
    const name = n.replace(/\/\.\.\.$/, '')
    if (!v || v === 'latest') return { ecosystem: eco, name }
    return /^v\d+\.\d+\.\d+([-+][\w.+-]+)?$/.test(v) ? { ecosystem: eco, name, version: v } : { ecosystem: eco, name, unverifiable: `version "${v}" (branch, commit, query or range) — pin an exact vX.Y.Z` }
  }
}

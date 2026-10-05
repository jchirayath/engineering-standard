#!/usr/bin/env node
// Pre-deploy scan of the EXACT directory about to be uploaded (ENGINEERING_STANDARD §2A, WEB-*). Zero deps.
//   node check-build.mjs <publish-dir> [--host swa|netlify|apache|caddy|nginx] [--allow-sourcemaps] [--allow <glob> ...] [--json]
// Also runs csp.mjs verify when a header config with a CSP exists (an edited inline script must not ship uncovered),
// and flags server config written for a different host (e.g. .htaccess on Caddy is served as a plain file).
// Run it in deploy.sh after staging and before upload; a non-zero exit must abort the deploy.
// Catches: private files that followed the build (.git, .env, keys, backups, server code, DB dumps, auth files),
// secrets inside shipped files, public source maps, mixed content, third-party scripts without SRI.
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative, resolve, basename, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const VALUED = ['--allow', '--host']
const dir = resolve(argv.find((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1])) || '')
const hostType = argv.includes('--host') ? argv[argv.indexOf('--host') + 1] : null
const allowMaps = argv.includes('--allow-sourcemaps'), json = argv.includes('--json')
const allow = argv.flatMap((a, i) => a === '--allow' ? [argv[i + 1]] : [])
const SRI_EXEMPT = ['www.googletagmanager.com', 'www.google-analytics.com', 'fonts.googleapis.com']
if (!argv.length || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) { console.error('usage: check-build.mjs <publish-dir> [--allow-sourcemaps] [--allow glob]'); process.exit(2) }

const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
  .replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*') + '$')
const allowed = (p) => allow.some(g => globRe(g).test(p))
const findings = []
const add = (level, id, file, msg) => findings.push({ level, id, file, msg })

// Files that must never be published, by path.
const FORBIDDEN = [
  [/(^|\/)\.git(\/|$)/, '.git directory'], [/(^|\/)\.env(\..*)?$/, 'environment file'], [/(^|\/)\.(svn|hg)(\/|$)/, 'VCS metadata'],
  [/\.(pem|key|p12|pfx|jks|keystore|ppk)$/i, 'private key / keystore'], [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, 'SSH key'],
  [/\.(bak|old|orig|save|swp|swo|tmp)$|~$/i, 'backup / editor file'], [/\.(sql|sqlite3?|db|dump)$/i, 'database file'],
  [/\.(log)$/i, 'log file'], [/(^|\/)\.DS_Store$/, '.DS_Store'], [/(^|\/)(\.htpasswd|\.npmrc|\.pypirc|\.netrc)$/, 'credential file'],
  [/(^|\/)[^/]*(auth|secret|credential|password)[^/]*\.(json|ya?ml|txt|ini)$/i, 'auth/secret file'],
  [/(^|\/)(server|app)\.(js|ts|py)$/, 'server-side code'], [/(^|\/)(package-lock|yarn\.lock|pnpm-lock|composer\.lock|Pipfile\.lock)/, 'lockfile'],
  [/(^|\/)(docker-compose\.ya?ml|Dockerfile|\.dockerignore|Makefile|deploy\.sh)$/, 'build/deploy file'],
  [/(^|\/)(node_modules|\.vscode|\.idea|\.claude)(\/|$)/, 'dev directory'],
]
// Secrets inside shipped text files.
const SECRETS = [
  [/-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/, 'private key'], [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\b(sk|rk)_live_[0-9a-zA-Z]{20,}/, 'Stripe live secret key'], [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'], [/AccountKey=[A-Za-z0-9+/=]{40,}/, 'Azure storage account key'],
  [/\bsk-(proj-)?[A-Za-z0-9_-]{32,}/, 'OpenAI-style secret key'], [/\bsk-ant-[A-Za-z0-9_-]{32,}/, 'Anthropic API key'],
  [/SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/, 'SendGrid key'], [/(postgres|mysql|mongodb(\+srv)?):\/\/[^:\s"']+:[^@\s"']+@/, 'DB URL with password'],
]
const TEXT = /\.(html?|js|mjs|cjs|css|json|txt|xml|svg|map|md|ya?ml|webmanifest|php|ini|conf)$/i

const walk = (d, out = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, out) : out.push(p) } return out }
const files = walk(dir)
for (const abs of files) {
  const rel = relative(dir, abs)
  if (allowed(rel)) continue
  for (const [re, what] of FORBIDDEN) if (re.test(rel)) { add('ERROR', 'WEB-1', rel, `${what} must not be published`); break }
  if (/\.map$/.test(rel) && !allowMaps) add('ERROR', 'WEB-7', rel, 'source map in publish dir (exposes original source)')
  if (!TEXT.test(rel) || statSync(abs).size > 5e6) continue
  const src = readFileSync(abs, 'utf8')
  for (const [re, what] of SECRETS) if (re.test(src)) add('ERROR', 'WEB-11', rel, `looks like a ${what}`)
  // Supabase/Firebase-style JWT with an elevated role (anon keys are public; service_role is not).
  for (const m of src.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try { const p = JSON.parse(Buffer.from(m[1], 'base64url').toString()); if (/service_role|admin|supabase_admin/.test(p.role || '')) add('ERROR', 'WEB-11', rel, `JWT with role "${p.role}" (server-only key)`) } catch {}
  }
  if (/\.(js|mjs|cjs)$/.test(rel) && /\/\/[#@]\s*sourceMappingURL=(?!data:)/.test(src) && !allowMaps) add('WARN', 'WEB-7', rel, 'references a source map (strip the comment in production builds)')
  if (!/\.html?$/i.test(rel)) continue
  for (const tag of src.match(/<(script|link|iframe)\b[^>]*>/gi) || []) {
    const kind = tag.slice(1).split(/[\s>]/)[0].toLowerCase()
    const url = tag.match(/\b(src|href)\s*=\s*["']([^"']+)/i)?.[2]
    if (!url) continue
    if (kind === 'link' && !/rel\s*=\s*["'][^"']*(stylesheet|preload|modulepreload)/i.test(tag)) continue
    if (url.startsWith('http://')) add('ERROR', 'WEB-5', rel, `mixed content <${kind}> ${url}`)
    if (/^https:\/\//.test(url) && kind !== 'iframe' && !/\bintegrity\s*=/.test(tag) && !SRI_EXEMPT.includes(new URL(url).host))
      add('WARN', 'WEB-6', rel, `third-party <${kind}> without integrity=: ${url}`)
  }
  const inlineHandlers = (src.match(/\son(click|load|error|submit|change|input|mouseover)\s*=/gi) || []).length
  if (inlineHandlers) add('WARN', 'WEB-3', rel, `${inlineHandlers} inline on*= handler(s) — blocked by a strict CSP; move to a script file`)
  for (const f of src.match(/<form\b[^>]*>/gi) || []) if (/action\s*=\s*["']http:\/\//i.test(f)) add('ERROR', 'WEB-5', rel, 'form posts over http://')
}

// Server config for the wrong host is shipped as a readable file.
const FOREIGN = { caddy: [/(^|\/)\.htaccess$/, /(^|\/)_headers$/, /(^|\/)_redirects$/], nginx: [/(^|\/)\.htaccess$/], swa: [/(^|\/)\.htaccess$/], netlify: [/(^|\/)\.htaccess$/] }
if (hostType) for (const abs of files) { const rel = relative(dir, abs); if ((FOREIGN[hostType] || []).some(re => re.test(rel))) add('ERROR', 'WEB-8', rel, `config for a different server — ${hostType} serves it as a public file; remove it from the deploy`) }

// CSP drift: the policy in the header config must still cover every inline script/handler and origin.
const cspRun = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'csp.mjs'), 'verify', dir], { encoding: 'utf8' })
for (const line of cspRun.stdout.split('\n').filter(l => l.startsWith('✗ CSP does not allow'))) add('ERROR', 'WEB-3', '(header config)', line.slice(2))

const errors = findings.filter(f => f.level === 'ERROR').length
if (json) console.log(JSON.stringify({ dir, files: files.length, findings }, null, 2))
else {
  for (const f of findings) console.log(`  ${f.level.padEnd(5)} ${f.id.padEnd(6)} ${f.file}  ${f.msg}`)
  console.log(`${errors ? '✗' : '✓'} build ${dir} — ${files.length} files, ${errors} errors, ${findings.length - errors} warnings`)
}
process.exit(errors ? 1 : 0)

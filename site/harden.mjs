#!/usr/bin/env node
// Apply the website security profile (ENGINEERING_STANDARD §2A) to a site repo. Zero deps. Idempotent.
//   node harden.mjs <site-repo> --host swa|netlify|apache|caddy|nginx [--publish <dir>] [--domain example.com]
//                   [--contact mailto:you@example.com] [--enforce] [--dry-run]
// Writes (in a managed block / managed keys, so re-running only updates what it owns):
//   swa      staticwebapp.config.json  globalHeaders + 404 routes for private paths
//   netlify  <publish>/_headers + <publish>/_redirects
//   apache   <publish>/.htaccess        https redirect, headers, Options -Indexes, private-path 403, compression
//   caddy    security_headers.caddy     snippet to `import` in the server's site block (applied on the server, not by deploy)
//   nginx    security_headers.nginx.conf  snippet to `include` in the server block
//   all      <publish>/.well-known/security.txt (if absent), standard.config.json site.host/publishDir (if absent)
// The CSP is computed from the site's own files by csp.mjs (inline-script hashes included). First run ships it as
// Content-Security-Policy-Report-Only; re-run with --enforce after a clean week. Nothing is deployed.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const repo = resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : '.')
const flag = (n) => argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined
const here = dirname(fileURLToPath(import.meta.url))
const cfgPath = join(repo, 'standard.config.json')
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {}
const site = cfg.site || {}
const host = flag('--host') || site.host
const HOSTS = ['swa', 'netlify', 'apache', 'caddy', 'nginx']
if (!HOSTS.includes(host)) { console.error(`usage: harden.mjs <site-repo> --host ${HOSTS.join('|')} [--publish dir] [--domain d] [--contact c] [--enforce] [--dry-run]`); process.exit(2) }
// --publish is relative to the current directory (CLI convention); site.publishDir is relative to the repo.
const publish = flag('--publish') ? resolve(flag('--publish')) : resolve(repo, site.publishDir || '.')
const domain = flag('--domain') || (site.urls?.[0] ? new URL(site.urls[0]).hostname.replace(/^www\./, '') : undefined)
const dry = argv.includes('--dry-run'), enforce = argv.includes('--enforce')
const changes = []
const write = (p, body) => {
  const old = existsSync(p) ? readFileSync(p, 'utf8') : null
  if (old === body) return
  changes.push(`${old === null ? 'create' : 'update'}  ${relative(repo, p)}`)
  if (!dry) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body) }
}
const BEGIN = '# BEGIN engineering-standard (managed by harden.mjs — edit the kit, not this block)', END = '# END engineering-standard'
const managed = (existing, block) => {
  const body = `${BEGIN}\n${block.trimEnd()}\n${END}\n`
  if (existing?.includes(BEGIN)) return existing.replace(new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END}\\n?`), body)
  return body + (existing ? `\n${existing}` : '')
}

if (publish === repo && !site.publishDir) console.warn('⚠ publish dir is the repo root — WEB-1 wants a staged allowlist; pass --publish or set site.publishDir')

// 1. CSP from the site's own files
const r = spawnSync(process.execPath, [join(here, 'csp.mjs'), 'suggest', publish], { encoding: 'utf8' })
if (r.status !== 0) { console.error(r.stderr); process.exit(1) }
const csp = r.stdout.trim()
process.stderr.write(r.stderr)
const cspName = enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'

// 2. Header set (baseline + computed CSP)
const baseline = JSON.parse(readFileSync(join(here, 'headers', 'baseline.json'), 'utf8')).baseline
const headers = { ...baseline }
delete headers['Content-Security-Policy']
headers[cspName] = csp
const PRIVATE = ['/.git/*', '/.env*', '/*.bak', '/*.sql', '/*.log', '/*.map', '/.htaccess', '/.DS_Store', '/server.js', '/package.json', '/composer.json']

// 3. Host-specific output
if (host === 'swa') {
  const p = join(repo, 'staticwebapp.config.json')
  const j = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
  j.globalHeaders = { ...(j.globalHeaders || {}), ...headers }
  delete j.globalHeaders[enforce ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy']
  const routes = (j.routes || []).filter(x => !x._standard)
  j.routes = [...PRIVATE.filter(pp => !pp.startsWith('/*.')).map(route => ({ route, statusCode: 404, _standard: true })), ...routes]
  write(p, JSON.stringify(j, null, 2) + '\n')
  if (publish !== repo) console.log(`→ make sure deploy copies staticwebapp.config.json into the staged dir (SWA reads it from the app root)`)
} else if (host === 'netlify') {
  const hp = join(publish, '_headers'), rp = join(publish, '_redirects')
  write(hp, managed(existsSync(hp) ? readFileSync(hp, 'utf8') : null, `/*\n${Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`).join('\n')}`))
  // Netlify only supports a trailing /* wildcard, so private files are listed exactly (check-build.mjs keeps globbed ones out).
  const NETLIFY_PRIVATE = ['/.git/*', '/.env', '/.env.local', '/.env.production', '/.htaccess', '/.DS_Store', '/server.js', '/package.json', '/composer.json']
  write(rp, managed(existsSync(rp) ? readFileSync(rp, 'utf8') : null, NETLIFY_PRIVATE.map(pp => `${pp}  /404  404!`).join('\n')))
} else if (host === 'apache') {
  const p = join(publish, '.htaccess')
  write(p, managed(existsSync(p) ? readFileSync(p, 'utf8') : null, [
    'Options -Indexes', 'ServerSignature Off',
    '<IfModule mod_rewrite.c>', '  RewriteEngine On', '  RewriteCond %{HTTPS} !=on', '  RewriteCond %{HTTP:X-Forwarded-Proto} !https', '  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]',
    '  RewriteRule (^|/)\\.(git|svn|hg|env|DS_Store|htpasswd|vscode) - [F,L]', '  RewriteRule \\.(bak|old|orig|sql|log|swp|map)$ - [F,L]', '  RewriteRule ^(server\\.js|package\\.json|composer\\.(json|lock))$ - [F,L]', '</IfModule>',
    '<IfModule mod_headers.c>', ...Object.entries(headers).map(([k, v]) => `  Header always set ${k} "${v}"`), '  Header always unset X-Powered-By', '</IfModule>',
    '<IfModule mod_deflate.c>', '  AddOutputFilterByType DEFLATE text/html text/css text/plain application/javascript application/json image/svg+xml', '</IfModule>',
    '<IfModule mod_expires.c>', '  ExpiresActive On', '  ExpiresByType image/webp "access plus 1 month"', '  ExpiresByType image/png "access plus 1 month"', '  ExpiresByType image/jpeg "access plus 1 month"', '  ExpiresByType text/css "access plus 1 week"', '  ExpiresByType application/javascript "access plus 1 week"', '</IfModule>',
  ].join('\n')))
} else if (host === 'caddy') {
  write(join(repo, 'security_headers.caddy'), [`# ${BEGIN.slice(2)}`, '# On the server, inside the site block:   import /path/to/security_headers.caddy', '# Caddy already redirects http→https and has no directory listing unless "browse" is set.',
    'encode zstd gzip', 'header {', ...Object.entries(headers).map(([k, v]) => `  ${k} "${v}"`), '  -Server', '  -X-Powered-By', '}',
    '@private path /.git/* /.env* /.htaccess /.DS_Store /*.bak /*.sql /*.log /*.map /server.js /package.json /composer.json /Caddyfile', 'respond @private 404', `# ${END.slice(2)}`, ''].join('\n'))
} else if (host === 'nginx') {
  write(join(repo, 'security_headers.nginx.conf'), [`# ${BEGIN.slice(2)}`, '# include inside the server {} block; also: return 301 https://$host$request_uri; in the port-80 server', 'server_tokens off;', 'autoindex off;', 'gzip on;',
    ...Object.entries(headers).map(([k, v]) => `add_header ${k} "${v}" always;`),
    'location ~ /\\.(git|svn|hg|env|htaccess|htpasswd|DS_Store) { return 404; }', 'location ~* \\.(bak|old|orig|sql|log|swp|map)$ { return 404; }', `# ${END.slice(2)}`, ''].join('\n'))
}

// 4. security.txt + config
const st = join(publish, '.well-known', 'security.txt')
if (!existsSync(st)) {
  const exp = new Date(Date.now() + 365 * 864e5).toISOString()
  write(st, `Contact: ${flag('--contact') || `mailto:security@${domain || 'example.com'}`}\nExpires: ${exp}\nPreferred-Languages: en\n${domain ? `Canonical: https://${domain}/.well-known/security.txt\n` : ''}`)
}
if (!site.host || !site.publishDir) {
  const next = { ...cfg, site: { ...site, host: site.host || host, publishDir: site.publishDir || relative(repo, publish) || '.' } }
  write(cfgPath, JSON.stringify(next, null, 2) + '\n')
}

console.log(changes.length ? changes.map(c => `  ${dry ? '(dry-run) ' : ''}${c}`).join('\n') : '  no changes — already hardened')
console.log(`\nCSP (${enforce ? 'enforced' : 'report-only — re-run with --enforce after a clean week'}): ${csp.length} chars`)
console.log(`Next: deploy, then  node ${relative(process.cwd(), join(here, 'check-site.mjs'))} --config ${relative(process.cwd(), cfgPath)}`)
if (host === 'caddy' || host === 'nginx') console.log(`      ${host} headers are applied on the SERVER: import/include the snippet in the site config and reload ${host}.`)

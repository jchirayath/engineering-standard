#!/usr/bin/env node
// Keeps owner data out of git. Run in CI (selftest) and by the pre-commit hook (.githooks/pre-commit).
//   node bin/check-public.mjs            tracked files: nothing under local/ (except its README), no real fleet file,
//                                        no secret-shaped files; plus the private denylist if local/denylist.txt exists
//   node bin/check-public.mjs --staged   the same checks on what is about to be committed (added lines only)
// local/denylist.txt (git-ignored, yours): one term per line — your domains, app names, analytics IDs, hostnames,
// emails. Lines starting with # are comments; a line starting with re: is a case-insensitive regex.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const staged = process.argv.includes('--staged')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 })
const files = (staged ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR') : git('ls-files')).split('\n').filter(Boolean)
const errors = []

const SECRET_FILE = /(^|\/)(\.env(\.[^/]*)?|\.envrc|id_(rsa|dsa|ecdsa|ed25519)|[^/]*\.(pem|key|p12|pfx|jks|keystore|kdbx)|\.npmrc|\.pypirc|\.netrc|\.git-credentials|credentials(\.json)?|service[-_]?account[^/]*\.json|env\.prod[^/]*\.json)$/i
const SAFE_NAME = /(^|\/)\.env\.(example|sample)$|\.(example|sample|template)(\.[^/]*)?$/i
for (const f of files) {
  if (f.startsWith('local/') && f !== 'local/README.md') errors.push(`${f}: owner data — it belongs in the git-ignored local/ (git rm --cached '${f}')`)
  else if (/^fleet\/.*\.json$/.test(f) && f !== 'fleet/sites.example.json') errors.push(`${f}: a real site list — keep it as local/sites.json`)
  else if (SECRET_FILE.test(f) && !SAFE_NAME.test(f)) errors.push(`${f}: secret-shaped file name — never commit it (AGT-1, SEC-11)`)
}

// Private denylist: terms only you know are sensitive. The list itself never leaves local/.
const DENY = 'local/denylist.txt'
if (existsSync(DENY)) {
  const terms = readFileSync(DENY, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  const toRe = (t) => t.startsWith('re:') ? new RegExp(t.slice(3), 'i') : new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const sources = staged
    ? [['the staged changes', git('diff', '--cached', '-U0', '--no-color').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n')]]
    : files.filter((f) => existsSync(f)).map((f) => { try { return [f, readFileSync(f, 'utf8')] } catch { return [f, ''] } })
  terms.forEach((t, i) => {
    const re = toRe(t), hit = sources.find(([, text]) => re.test(text))
    if (hit) errors.push(`denylist term #${i + 1} (${DENY}) found in ${hit[0]} — remove it, or move that content to local/`)
  })
}

for (const e of errors) console.error(`✗ ${e}`)
console.log(`${files.length} ${staged ? 'staged' : 'tracked'} file(s), ${errors.length} problem(s)${existsSync(DENY) ? '' : ' (no local/denylist.txt — add one to check your private terms)'}`)
process.exit(errors.length ? 1 : 0)

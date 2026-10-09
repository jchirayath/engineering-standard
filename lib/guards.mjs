// Pure policy checks used by the hooks (and unit-tested by plugin/test/run.mjs). Zero deps.
import { basename, dirname, resolve } from 'node:path'
import { readdirSync, realpathSync } from 'node:fs'
import { shellWords, commandSegments, expandBraces } from './deps.mjs'

// ── AGT-1: secrets never enter the agent's context ─────────────────────────────────────────────
const ENV_OK = /^\.env\.(example|sample)$/i
export function secretPath(p) {
  if (!p || typeof p !== 'string') return null
  // Case-insensitive: macOS/Windows file systems are, so `.ENV` is the same file as `.env`.
  const s = p.replace(/\\/g, '/').toLowerCase(), b = basename(s)
  if (/(^|\/)\.ssh(\/|$)/.test(s) || /^~\/\.ssh/.test(s)) return '~/.ssh/**'
  if (/(^|\/)\.(aws|gnupg|azure|kube|docker)\/(credentials|config|.*\.(json|key|gpg))$/.test(s) || /(^|\/)\.gnupg\//.test(s)) return 'cloud/CLI credential files'
  if (/(^|\/)secrets?(\/|$)/.test(s)) return 'secrets/**'
  if (b === '.env' || b === '.envrc' || (/^\.env\./.test(b) && !ENV_OK.test(b))) return '.env / .env.*'
  if (/\.(pem|key|p12|pfx|jks|keystore|ppk|asc|gpg|kdbx)$/.test(b)) return 'private keys / keystores'
  if (/^id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/.test(b)) return 'SSH private keys'
  if (/^(\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.pgpass|credentials(\.json)?|service[-_]?account.*\.json|.*-sa-key.*\.json)$/.test(b)) return 'credential files'
  if (/^env\.prod.*\.json$/.test(b)) return 'env.prod*.json'
  return null
}
// Also check where a symlink points, and expand shell globs (`cat .e*`) against the real directory.
export function secretPathResolved(p, cwd = process.cwd()) {
  const direct = secretPath(p); if (direct) return direct
  if (typeof p !== 'string' || !p) return null
  const abs = resolve(cwd, p.replace(/^~(?=\/)/, process.env.HOME || '~'))
  try { const real = realpathSync(abs); const hit = secretPath(real); if (hit) return hit } catch {}
  if (/[*?[]/.test(p)) {
    const re = new RegExp('^' + basename(p).replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
    const dotOk = basename(p).startsWith('.')                         // shells don't expand * to dotfiles
    let files
    try { files = readdirSync(dirname(abs)) } catch { return /^\.[*?e]/i.test(basename(p)) ? 'glob that can match .env' : null }
    for (const f of files) if ((dotOk || !f.startsWith('.')) && re.test(f)) { const hit = secretPath(f); if (hit) return hit }
  }
  return null
}
// Paths a file tool would touch: Read/Edit/Write file_path, NotebookEdit notebook_path, Grep path + glob.
export function toolPaths(input = {}) {
  return [input.file_path, input.notebook_path, input.path, input.glob].filter((x) => typeof x === 'string' && x)
}

// ── Bash policy ────────────────────────────────────────────────────────────────────────────────
// Commands that only test for existence/metadata may name a secret path; every other command that names
// one (cat, source, cp, python -c, git add …) is blocked — a reader allow-list is too easy to go around.
const NON_READERS = new Set(['ls', 'test', '[', 'stat', 'rm', 'touch', 'chmod'])
const segments = (cmd) => commandSegments(cmd)
// → { rule, reason } for the first violation, else null. `branch` = current git branch (for bare `git push -f`).
export function bashViolation(cmd, { branch, cwd } = {}) {
  if (/--dangerously-skip-permissions\b/.test(cmd)) return { rule: 'AGT-3', reason: '`--dangerously-skip-permissions` runs only inside a disposable container with no production credentials (AGT-3).' }
  if (/\b(curl|wget)\b[^\n;&]*\|\s*(sudo\s+)?(env\s+)?(ba|z|da|k|fi)?sh\b/.test(cmd) || /\b(ba|z)?sh\s+(-c\s+)?["']?\$\(\s*(curl|wget)\b/.test(cmd) || /\b(ba|z)?sh\s+<\(\s*(curl|wget)\b/.test(cmd))
    return { rule: 'SEC-31', reason: 'Piping a downloaded script into a shell executes unverified code (SEC-31, supply chain). Download it, read it, pin its checksum, then run it.' }
  for (const seg of segments(cmd)) {
    const w = shellWords(seg.replace(/^\s*([A-Z_][A-Z0-9_]*=\S*\s+)*/, ''))
    if (w[0] === 'git') {
      const sub = w.find((x, i) => i > 0 && !x.startsWith('-') && w[i - 1] !== '-C' && w[i - 1] !== '-c')
      const shortN = (x) => /^-[a-zA-Z]+$/.test(x) && /n/.test(x.slice(1).split(/[mFcCtS]/)[0])
      if (w.includes('--no-verify') || (sub === 'commit' && w.some(shortN)))
        return { rule: 'ENF-2', reason: '`--no-verify` skips the repo\'s pre-commit/pre-push gates (§7.3, ENF-2). Fix the failing check, or record an exception in docs/STANDARD_EXCEPTIONS.md.' }
      if (sub === 'push') {
        const force = w.some((x) => /^(--force|--force-with-lease(=.*)?|-f)$/.test(x) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(x))
        const refs = w.slice(w.indexOf('push') + 1).filter((x) => !x.startsWith('-'))
        const plusMain = refs.some((r) => /^\+.*\b(main|master)$/.test(r))
        const toMain = refs.slice(1).some((r) => /(^|[:/+])(main|master)$/.test(r)) || (refs.length <= 1 && /^(main|master)$/.test(branch || ''))
        if ((force && toMain) || plusMain) return { rule: 'REPO-2', reason: 'Force-pushing to main/master rewrites protected history (REPO-2: protected main, no force-push).' }
      }
    }
    const cmd0 = basename(w[0] || '')
    const redirect = (seg.match(/<\s*([^\s<>|&;]+)/) || [])[1]
    const toks = NON_READERS.has(cmd0) && !redirect ? [] : [...w, redirect].filter(Boolean)
      .flatMap(expandBraces).flatMap((t) => [t, ...t.split(/[=:,'"()]/)])   // .{env,x}, --env-file=.env, open('.env')
    for (const t of toks) {
      if (!t || (t.startsWith('-') && !t.includes('/') && !t.includes('.'))) continue
      const hit = secretPathResolved(t.replace(/^[@-]+/, ''), cwd)
      if (hit) return { rule: 'AGT-1', reason: `\`${t}\` (${hit}) would put secrets into the agent's context (AGT-1). Use .env.example for key names; ask the user for any value you need.` }
    }
  }
  return null
}

// ── AGT-8 / TEST-5: never loosen tests to make them pass ───────────────────────────────────────
export function isTestFile(p = '') {
  const s = p.replace(/\\/g, '/'), b = basename(s)
  return /(^|\/)(test|tests|__tests__|spec|specs|integration_test|e2e|testing)\//.test(s) || /[._-](test|spec)\.[cm]?[jt]sx?$/.test(b) ||
    /_test\.(go|dart|py)$/.test(b) || /^test_.*\.py$/.test(b) || /Tests?\.swift$/.test(b)
}
const ASSERT = /\bexpect\s*\(|\bexpectLater\s*\(|\bassert\w*\s*[(\s.]|\bXCTAssert\w*|\bt\.(Error|Errorf|Fatal|Fatalf)\s*\(|\bshould\.\w|\bself\.assert\w+|\bassertThat\s*\(/
const SKIP = /\b(it|test|describe|context|suite|bench|testWidgets|group|this)\.(skip|only|skipIf)\b|(^|\s)(xit|xdescribe|xtest|fit|fdescribe)\s*\(|@skip\b|@pytest\.mark\.(skip|xfail)\b|@unittest\.skip|\bskip\s*:\s*(?!false\b)|\bt\.Skip(Now|f)?\s*\(|\bXCTSkip\w*|@Disabled\b|\btest\.fixme\s*\(/
const lines = (s = '') => s.split('\n')
const count = (s, re) => lines(s).filter((l) => re.test(l)).length
const quarantined = (l) => { const q = l.search(/quarantine/i); return q >= 0 && /\b\d{4}-\d{2}-\d{2}\b/.test(l) && /@[A-Za-z0-9][\w-]*(?![\w.(-])/.test(l.slice(q)) }
// before/after = file text (or Edit old_string/new_string). → { rule, reason } or null.
export function testLoosening(path, before = '', after = '') {
  if (!isTestFile(path)) return null
  const a0 = count(before, ASSERT), a1 = count(after, ASSERT)
  if (a1 < a0) return { rule: 'AGT-8', reason: `This edit removes ${a0 - a1} assertion line(s) from ${basename(path)} (AGT-8: never delete or loosen an assertion to make tests pass; TEST-8). If the behaviour truly changed, keep an equivalent assertion for the new behaviour, or ask the user to approve the removal (they can set STANDARD_ALLOW_TEST_EDIT=1).` }
  const old = new Set(lines(before).map((l) => l.trim()))
  for (const l of lines(after)) {
    if (!SKIP.test(l) || old.has(l.trim())) continue
    if (/\.only\s*\(|(^|\s)(fit|fdescribe)\s*\(/.test(l)) return { rule: 'AGT-8', reason: `\`.only\`/focused test added in ${basename(path)} — it silently skips every other test (AGT-8).` }
    if (!quarantined(l)) return { rule: 'TEST-5', reason: `Skipped test added in ${basename(path)}: "${l.trim().slice(0, 100)}". AGT-8 forbids skipping tests to get green; TEST-5 allows quarantine only with an owner and a date in the skip reason, e.g. skip: 'quarantine @owner 2026-11-30 flaky on CI #123'.` }
  }
  return null
}

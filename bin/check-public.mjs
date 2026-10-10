#!/usr/bin/env node
// Fails when owner-specific data is tracked by git: anything under local/ except its README, a fleet file other
// than the example, or files under proposals/ that name a finding in a specific app. Run in CI (selftest).
import { execFileSync } from 'node:child_process'
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const bad = files.filter((f) => (f.startsWith('local/') && f !== 'local/README.md') || (/^fleet\/.*\.json$/.test(f) && f !== 'fleet/sites.example.json'))
for (const f of bad) console.error(`✗ ${f} is owner data — keep it in the git-ignored local/ (git rm --cached '${f}')`)
console.log(`${files.length} tracked files, ${bad.length} owner-data file(s)`)
process.exit(bad.length ? 1 : 0)

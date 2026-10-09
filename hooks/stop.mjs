#!/usr/bin/env node
// Stop — cheap TEST-0 reminder: source files changed (git working tree) but no test file changed.
// Never runs test suites. Blocks ONCE per distinct change set so Claude sees the reminder; the marker file
// and stop_hook_active guarantee the next stop goes through (no loops). STANDARD_STOP_MODE=notify only
// shows it to the user.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { hook, emit, projectDir } from '../lib/hookio.mjs'
import { isTestFile } from '../lib/guards.mjs'
import { CODE_EXT } from '../lib/semgrep.mjs'

hook((input) => {
  if (input.stop_hook_active) return
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: projectDir(input), encoding: 'utf8', timeout: 1500 })
  if (r.status !== 0) return
  const files = r.stdout.split('\n').filter(Boolean).filter((l) => !l.startsWith(' D') && !l.startsWith('D ')).map((l) => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''))
  const tests = files.filter(isTestFile)
  const src = files.filter((f) => CODE_EXT.test(f) && !isTestFile(f) && !/(^|\/)(generated|build|dist|\.next|node_modules)\/|\.(g|freezed|gen)\.dart$|\.config\.[cm]?[jt]s$|\.d\.ts$/.test(f))
  if (!src.length || tests.length) return
  const key = createHash('sha256').update(src.sort().join('\n')).digest('hex').slice(0, 16)
  const mark = join(tmpdir(), `engineering-standard-stop-${String(input.session_id || 'x').replace(/\W/g, '')}`)
  if (existsSync(mark) && readFileSync(mark, 'utf8') === key) return
  writeFileSync(mark, key)
  const msg = `TEST-0: ${src.length} source file(s) changed with no test changes (${src.slice(0, 5).join(', ')}${src.length > 5 ? ', …' : ''}). ` +
    'Add or update the unit/integration/e2e/walkthrough tests, run them and tools/standard/check.sh, and report the real output — never "should pass".'
  if (process.env.STANDARD_STOP_MODE === 'notify') emit({ systemMessage: `[engineering-standard] ${msg}` })
  emit({ decision: 'block', reason: `[engineering-standard] ${msg} If tests are genuinely not applicable, say why and stop.` })
})

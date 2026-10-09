#!/usr/bin/env node
// PreToolUse Edit|Write|MultiEdit — AGT-8 / TEST-5: never remove assertions or skip tests to get green.
// Escape hatch for a human-approved change: STANDARD_ALLOW_TEST_EDIT=1 in the Claude Code environment.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { hook, block, projectDir } from '../lib/hookio.mjs'
import { isTestFile, testLoosening } from '../lib/guards.mjs'

hook((input) => {
  const ti = input.tool_input || {}, path = ti.file_path || ''
  if (!isTestFile(path) || process.env.STANDARD_ALLOW_TEST_EDIT === '1') return
  let before = '', after = ''
  if (input.tool_name === 'Write') {
    const abs = resolve(projectDir(input), path)
    before = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
    after = ti.content || ''
  } else if (Array.isArray(ti.edits)) {
    before = ti.edits.map((e) => e.old_string || '').join('\n'); after = ti.edits.map((e) => e.new_string || '').join('\n')
  } else { before = ti.old_string || ''; after = ti.new_string || '' }
  const v = testLoosening(path, before, after)
  if (v) block(v.reason)
})

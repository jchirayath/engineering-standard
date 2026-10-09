#!/usr/bin/env node
// PreToolUse Read|Edit|Write|MultiEdit|NotebookEdit|Grep — AGT-1: secrets never enter the agent's context.
import { hook, block } from '../lib/hookio.mjs'
import { secretPathResolved, toolPaths } from '../lib/guards.mjs'
import { projectDir } from '../lib/hookio.mjs'

hook((input) => {
  for (const p of toolPaths(input.tool_input)) {
    const hit = secretPathResolved(p, projectDir(input))
    if (hit) block(`${input.tool_name} on ${p} matches ${hit} (AGT-1: secret files are never read or edited by an agent). Use .env.example / .env.sample for key names and ask the user for any value you need.`)
  }
})

#!/usr/bin/env node
// Called by adopt.sh: makes a repo's agent configuration meet the standard without overwriting what is there.
//   node bin/adopt-config.mjs <repo> [--mode quick|client] [--site]
// - .claude/settings.json   AGT-1 deny rules + bypass disabled, and the engineering-standard plugin enabled for
//                           everyone who opens the repo, pinned to the kit's release tag (merged; never removes anything)
// - standard.config.json    "mode" (ENF-4): kept if set, else --mode, else client; websites are always client
// - CLAUDE.md               the one adoption line (appended if the file exists and doesn't mention the standard)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [repo, ...args] = process.argv.slice(2)
if (!repo) { console.error('usage: adopt-config.mjs <repo> [--mode quick|client] [--site]'); process.exit(2) }
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const site = args.includes('--site'), wantMode = flag('--mode')
const version = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim()
if (wantMode && !['quick', 'client'].includes(wantMode)) { console.error(`--mode must be quick or client, not "${wantMode}"`); process.exit(2) }
const say = (verb, what) => console.log(`  ${verb.padEnd(8)} ${what}`)
const readJSON = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch (e) { return e.code === 'ENOENT' ? null : undefined } }
const write = (f, o) => writeFileSync(f, JSON.stringify(o, null, 2) + '\n')

// 1. .claude/settings.json — AGT-1 (the deny list names .env variants, so .env.example stays readable)
const DENY = ['Read(./.env)', 'Read(./.env.local)', 'Read(./.env.*.local)', 'Read(./.env.production)', 'Read(./.env.development)',
  'Read(./.env.staging)', 'Read(./.env.test)', 'Read(./secrets/**)', 'Read(./**/env.prod*.json)', 'Read(~/.ssh/**)', 'Read(~/.aws/**)']
const sf = join(repo, '.claude', 'settings.json'), cur = readJSON(sf)
if (cur === undefined) say('skip', '.claude/settings.json is not valid JSON — fix it, then re-run (AGT-1 not applied)')
else {
  const s = cur || {}, before = JSON.stringify(s)
  s.permissions ||= {}
  s.permissions.deny = [...new Set([...(s.permissions.deny || []), ...DENY])]
  s.permissions.disableBypassPermissionsMode ??= 'disable'
  s.extraKnownMarketplaces ||= {}
  // Pinned to the kit's immutable release tag (AGT-5): a push to main never changes what runs in this repo's sessions.
  // Re-running adopt.sh from a newer kit moves the pin — that is the upgrade.
  const ref = `v${version}`, known = s.extraKnownMarketplaces['engineering-standard']
  if (!known || known.source?.repo === 'jchirayath/engineering-standard') s.extraKnownMarketplaces['engineering-standard'] = { source: { source: 'github', repo: 'jchirayath/engineering-standard', ref } }
  s.enabledPlugins ||= {}
  s.enabledPlugins['engineering-standard@engineering-standard'] ??= true
  if (JSON.stringify(s) !== before) { mkdirSync(join(repo, '.claude'), { recursive: true }); write(sf, s); say(cur ? 'updated' : 'created', `.claude/settings.json (AGT-1 deny rules, bypass disabled, plugin enabled, pinned to v${version})`) }
  else say('keep', '.claude/settings.json')
}

// 2. standard.config.json — mode
const cf = join(repo, 'standard.config.json'), cfg = readJSON(cf)
if (cfg === undefined) say('skip', 'standard.config.json is not valid JSON — set "mode" by hand')
else {
  const c = cfg || {}, mode = site ? 'client' : wantMode || c.mode || 'client'
  if (c.mode !== mode) { c.mode = mode; write(cf, c); say(cfg ? 'updated' : 'created', `standard.config.json (mode: ${mode}${site ? ' — a public website is always client, ENF-4' : ''})`) }
  else say('keep', `standard.config.json (mode: ${mode})`)
}

// 3. CLAUDE.md — one line; the plugin delivers the rules, so nothing is restated here
const LINE = 'This repo follows the engineering standard (https://github.com/jchirayath/engineering-standard): mode in `standard.config.json`, deviations in `docs/STANDARD_EXCEPTIONS.md`. The `engineering-standard` plugin supplies the rules (MCP `rules_for` / `rule`) and the agent loop; run `tools/standard/check.sh` before saying done.'
const md = join(repo, 'CLAUDE.md'), text = existsSync(md) ? readFileSync(md, 'utf8') : null
if (text == null) { writeFileSync(md, `# CLAUDE.md\n\n${LINE}\n`); say('created', 'CLAUDE.md') }
else if (/engineering[- ]standard|ENGINEERING_STANDARD/i.test(text)) say('keep', 'CLAUDE.md (already references the standard)')
else { writeFileSync(md, text.replace(/\s*$/, '\n\n') + LINE + '\n'); say('updated', 'CLAUDE.md (adoption line appended)') }

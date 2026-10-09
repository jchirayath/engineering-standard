#!/usr/bin/env node
// SessionStart — detect the repo's stack and inject the four pillars + the stack's MUST rule IDs/titles
// (~1–1.5 KB, never the 78 KB document), plus warnings: kit VERSION behind, AGT-1 settings, AGT-7 subagents.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { hook, emit, projectDir } from '../lib/hookio.mjs'
import { loadRules, loadStacks, expandStacks, kitVersion, cmpSemver } from '../lib/rules.mjs'

const BUDGET = 1500
const has = (d, f) => existsSync(join(d, f))
const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
const LLM_DEP = /["'\s](openai|@anthropic-ai\/sdk|anthropic|ai|@ai-sdk\/[\w-]+|langchain|@langchain\/[\w-]+|llamaindex|google-generativeai|@google\/genai|firebase_ai|google_generative_ai)["'\s=<>~^:]/

export function detectStacks(root) {
  const s = new Set(), dirs = [root]
  try { for (const e of readdirSync(root)) if (!e.startsWith('.') && !['node_modules', 'build', 'dist'].includes(e) && statSync(join(root, e)).isDirectory()) dirs.push(join(root, e)) } catch {}
  for (const sub of ['apps', 'packages', 'services']) try { for (const e of readdirSync(join(root, sub))) dirs.push(join(root, sub, e)) } catch {}
  for (const d of dirs.slice(0, 80)) {
    if (has(d, 'pubspec.yaml')) { s.add('flutter'); const p = read(join(d, 'pubspec.yaml')); if (/supabase_flutter/.test(p)) s.add('supabase'); if (/firebase_core/.test(p)) s.add('firebase'); if (LLM_DEP.test(p)) s.add('llm') }
    if (has(d, 'package.json')) {
      const p = read(join(d, 'package.json')); s.add('node')
      if (/"next"\s*:/.test(p)) s.add('nextjs')
      if (/"(react|vue|svelte|vite|astro|@angular\/core|solid-js)"\s*:/.test(p)) s.add('web')
      if (/"@supabase\/supabase-js"/.test(p)) s.add('supabase'); if (/"firebase(-admin)?"\s*:/.test(p)) s.add('firebase')
      if (LLM_DEP.test(p)) s.add('llm')
    }
    if (has(d, 'supabase/config.toml') || (d === root && has(d, 'supabase'))) s.add('supabase')
    if (has(d, 'firebase.json') || has(d, '.firebaserc')) s.add('firebase')
    if (has(d, 'go.mod')) s.add('go')
    for (const f of ['pyproject.toml', 'requirements.txt', 'setup.py', 'uv.lock']) if (has(d, f)) { s.add('python'); if (LLM_DEP.test(' ' + read(join(d, f)).replace(/\n/g, ' ') + ' ')) s.add('llm') }
    if (has(d, 'Package.swift')) s.add('swift')
    try { for (const e of readdirSync(d)) { if (e.endsWith('.xcodeproj')) s.add('ios').add('swift'); if (e.endsWith('.bicep') || e === 'azure.yaml' || e === 'staticwebapp.config.json' || e === 'host.json') s.add('azure') } } catch {}
    if (has(d, 'build.gradle') || has(d, 'build.gradle.kts') || has(d, 'app/src/main/AndroidManifest.xml')) s.add('android')
    if (has(d, 'ios/Runner.xcodeproj')) s.add('ios'); if (has(d, 'android/app')) s.add('android')
  }
  const cfg = read(join(root, 'standard.config.json'))
  if (/"site"\s*:/.test(cfg) || ((has(root, 'index.html') || has(root, 'public/index.html')) && !s.has('node'))) s.add('website')
  if (has(root, '.claude/agents')) s.add('agent')
  return [...expandStacks([...s], loadStacks())]
}

export function warnings(root) {
  const w = [], plugin = kitVersion(), isRepo = has(root, '.git')
  const vendored = read(join(root, 'tools/standard/VERSION')).trim()
  if (vendored && cmpSemver(vendored, plugin) < 0) w.push(`kit in tools/standard is v${vendored}, plugin is v${plugin} — re-run adopt.sh (/engineering-standard:adopt)`)
  else if (!vendored && isRepo) w.push('kit not adopted (no tools/standard/VERSION) — ENF-1: run /engineering-standard:adopt')
  if (isRepo) {
    let s = {}; try { s = JSON.parse(read(join(root, '.claude/settings.json')) || '{}') } catch { w.push('AGT-1: .claude/settings.json is not valid JSON') }
    const deny = s.permissions?.deny || [], miss = []
    if (!deny.some((d) => /^Read\(.*\.env/.test(d))) miss.push('deny Read(./.env*)')
    if (!deny.some((d) => /^Read\(.*secrets/.test(d))) miss.push('deny Read(./secrets/**)')
    if (s.permissions?.disableBypassPermissionsMode !== 'disable') miss.push('permissions.disableBypassPermissionsMode:"disable"')
    if (miss.length) w.push(`AGT-1: .claude/settings.json lacks ${miss.join(', ')}`)
  }
  try {
    const bad = readdirSync(join(root, '.claude/agents')).filter((f) => f.endsWith('.md')).filter((f) => {
      const fm = read(join(root, '.claude/agents', f)).match(/^---\n([\s\S]*?)\n---/)
      return !fm || !/^tools\s*:/m.test(fm[1])
    })
    if (bad.length) w.push(`AGT-7: subagents without a tools: allow-list: ${bad.join(', ')}`)
  } catch {}
  return w
}

export function context(root) {
  const { rules, pillars, version } = loadRules()
  const stacks = detectStacks(root), specific = new Set(stacks)
  const warn = warnings(root)
  const shortBar = (b) => b.replace(/\.$/, "")
  const head = [
    `[engineering-standard v${version}] Stack: ${stacks.join(', ') || 'unknown'}. Build to ENGINEERING_STANDARD.md and cite rule IDs. Full rule text: MCP server "standard" (rule, rules_for) — never guess a rule.`,
    `Pillars: ${pillars.map((p) => `${p.name}: ${shortBar(p.bar)}`).join(' | ')}`,
  ]
  const core = [...new Set(rules.filter((r) => r.stacks.includes('all') && r.level === 'MUST').map((r) => r.prefix))]
  const tailLines = [`Core MUST (every repo): ${core.join(' ')} — rules_for(["all"], topic) before touching auth, data, logging, deps or tests.`,
    ...warn.map((x) => `⚠ ${x}`)]
  const PRIO = ['nextjs', 'flutter', 'supabase', 'firebase', 'llm', 'azure', 'go', 'python', 'swift', 'ios', 'android', 'mobile', 'node', 'web', 'website', 'agent']
  const rank = (r) => Math.min(...r.stacks.filter((s) => specific.has(s)).map((s) => (PRIO.indexOf(s) + 1) || 99))
  const stackRules = rules.filter((r) => r.level === 'MUST' && !r.stacks.includes('all') && r.stacks.some((s) => specific.has(s)))
    .map((r, i) => [rank(r) * 10 + Math.min(r.stacks.length, 9), i, r]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2])
  let room = BUDGET - [...head, ...tailLines].join('\n').length - 40
  const items = []
  for (const r of stackRules) {
    const t = r.title.length > 44 ? r.title.slice(0, 42).replace(/\s\S*$/, '') + '…' : r.title
    const item = `${r.id} ${t}`
    if (room - item.length - 3 < 0) break
    items.push(item); room -= item.length + 3
  }
  const more = stackRules.length - items.length
  const mid = stackRules.length ? [`Stack MUST: ${items.join(' · ')}${more ? ` · +${more} more (rules_for)` : ''}`] : []
  return [...head, ...mid, ...tailLines].join('\n')
}

if (import.meta.url.endsWith(process.argv[1]?.split('/').pop())) {
  hook((input) => emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context(projectDir(input)) } }))
}

// Standard modes (plugin/modes.json): quick ⊂ client. Resolution + rule→modes assignment. Zero deps.
// bin/check-tests.mjs is vendored standalone into repos, so it carries its own copy of resolveMode's precedence.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, readJSON } from './rules.mjs'

let cache
export const loadModes = () => (cache ??= readJSON(join(ROOT, 'plugin/modes.json')))

// When a quick repo must become client (ENF-4). The rule text in build/rules.json is authoritative once defined.
export const PROMOTION_TRIGGERS = ["users outside the owner's team", 'an app-store listing',
  'a public URL (access-controlled previews are fine)', 'personal data of third parties']

// rule id → ['quick','client'] | ['client']. ids win over prefixes; quickExclude removes ids that came in via a prefix.
export function modesFor(id, m = loadModes()) {
  const q = m.quick || {}, prefix = id.split('-')[0]
  const quick = (q.ids || []).includes(id) || ((q.prefixes || []).includes(prefix) && !(q.quickExclude || []).includes(id))
  return quick ? ['quick', 'client'] : ['client']
}

// explicit argument > env STANDARD_MODE > <root>/standard.config.json "mode" > modes.json default.
// → { mode, source }. Throws on an invalid value, naming the source and the valid modes.
export function resolveMode({ arg, root = process.cwd(), env = process.env } = {}) {
  const { modes, default: def } = loadModes()
  const pick = (v, source) => {
    const mode = String(v).toLowerCase().trim()
    if (!modes.includes(mode)) throw new Error(`invalid mode "${v}" (${source}) — valid modes: ${modes.join(', ')}`)
    return { mode, source }
  }
  if (arg != null && arg !== '') return pick(arg, 'argument')
  if (env.STANDARD_MODE) return pick(env.STANDARD_MODE, 'env STANDARD_MODE')
  const cfg = join(root, 'standard.config.json')
  if (existsSync(cfg)) {
    let j; try { j = JSON.parse(readFileSync(cfg, 'utf8')) } catch { j = {} }
    if (j.mode != null) return pick(j.mode, 'standard.config.json')
  }
  return { mode: def, source: 'default' }
}

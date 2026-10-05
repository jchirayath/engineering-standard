// Shared, zero-dependency DTCG token loading for validate.mjs and build.mjs.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const load = (p) => JSON.parse(readFileSync(p, 'utf8'))

// DTCG tree → { 'color.text.primary': { value, type } }
export function flatten(node, prefix = '', out = {}, inheritedType) {
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$')) continue
    const path = prefix ? `${prefix}.${k}` : k
    const type = v?.$type || inheritedType
    if (v && typeof v === 'object' && '$value' in v) out[path] = { value: v.$value, type }
    else if (v && typeof v === 'object') flatten(v, path, out, type)
  }
  return out
}

// Resolve {references}; report unresolved refs and cycles through onError.
export function resolveAll(flat, label, onError = () => {}) {
  const get = (path, seen = []) => {
    if (seen.includes(path)) { onError(`${label}: reference cycle ${[...seen, path].join(' → ')}`); return undefined }
    const t = flat[path]
    if (!t) return undefined
    const m = typeof t.value === 'string' && t.value.match(/^\{([^}]+)\}$/)
    if (!m) return t.value
    if (flat[m[1]] === undefined) { onError(`${label}: ${path} → {${m[1]}} does not resolve`); return undefined }
    return get(m[1], [...seen, path])
  }
  return Object.fromEntries(Object.keys(flat).map(k => [k, get(k)]))
}

// Load primitive, base, each semantic mode, and presets (a preset = { "$extends": "light|dark", ...overrides }).
export function loadTokens(tokensDir, modeNames) {
  const opt = (f) => existsSync(join(tokensDir, f)) ? flatten(load(join(tokensDir, f))) : {}
  const primitive = opt('primitive.json'), base = opt('base.json'), modes = {}, missing = []
  for (const m of modeNames) {
    const p = join(tokensDir, `semantic.${m}.json`)
    if (existsSync(p)) modes[m] = flatten(load(p)); else missing.push(`semantic.${m}.json`)
  }
  const presets = {}
  const presetDir = join(tokensDir, 'presets')
  if (existsSync(presetDir)) for (const f of readdirSync(presetDir).filter(f => f.endsWith('.json')).sort()) {
    const raw = load(join(presetDir, f)); const ext = raw.$extends || 'light'
    presets[f.replace(/\.json$/, '')] = { extends: ext, tokens: { ...(modes[ext] || {}), ...flatten(raw) } }
  }
  return { primitive, base, modes, presets, missing }
}

// Hex helpers
export const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
export function rgba(hex) {
  let h = hex.slice(1); if (h.length === 3) h = [...h].map(c => c + c).join('')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
           a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1, hex6: h.slice(0, 6).toUpperCase(),
           alphaHex: (h.length === 8 ? h.slice(6, 8) : 'ff').toUpperCase() }
}
const lum = ({ r, g, b }) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
export const contrast = (a, b) => { const [x, y] = [lum(rgba(a)), lum(rgba(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// Naming
export const camel = (parts) => parts.map((p, i) => i ? p[0].toUpperCase() + p.slice(1) : p).join('')
export const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

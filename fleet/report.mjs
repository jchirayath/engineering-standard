#!/usr/bin/env node
// Turn check-site.mjs --json output into a markdown report (and the GitHub issue body).
//   node report.mjs results.json > report.md      exit 1 if any ERROR
import { readFileSync } from 'node:fs'
const results = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const count = (r, l) => r.findings.filter(f => f.level === l).length
const errs = results.reduce((n, r) => n + count(r, 'ERROR'), 0), warns = results.reduce((n, r) => n + count(r, 'WARN'), 0)
const out = []
out.push(`## Site check — ${new Date().toISOString().slice(0, 10)}`, '',
  `**${errs} errors, ${warns} warnings across ${results.length} hostnames.** ${errs ? 'Fix ERRORs first; most header/exposure fixes are applied by `site/harden.mjs`.' : 'All hostnames pass.'}`, '',
  '| Site | Errors | Warnings | GA | Pages | Libraries |', '|---|---|---|---|---|---|')
for (const r of results) out.push(`| ${r.url.replace('https://', '')} | ${count(r, 'ERROR') ? `**${count(r, 'ERROR')}**` : 0} | ${count(r, 'WARN')} | ${r.summary.ga === 'NONE' ? '**none**' : (r.summary.ga || '').split(',').length > 1 ? 'tag found' : r.summary.ga} | ${r.summary.pages ?? '–'} | ${r.summary.libs ?? '–'} |`)
for (const r of results.filter(r => count(r, 'ERROR') || count(r, 'WARN'))) {
  out.push('', `### ${r.url.replace('https://', '')}`, '')
  for (const f of r.findings.filter(f => f.level !== 'INFO').sort((a, b) => (a.level === 'ERROR' ? -1 : 1) - (b.level === 'ERROR' ? -1 : 1)))
    out.push(`- ${f.level === 'ERROR' ? '🔴' : '🟡'} **${f.cat}** \`${f.id}\` ${f.msg}${f.fix ? `  \n  ↳ ${f.fix}` : ''}`)
}
console.log(out.join('\n'))
process.exit(errs ? 1 : 0)

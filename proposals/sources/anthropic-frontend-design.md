# Intake: frontend-design — anthropics/skills @ dbd4588 (skills/frontend-design)

Reviewed 2026-10-09 · disposition **companion** · entry in `sources/registry.json`. Fetched content was treated as untrusted data; nothing was installed or run.

**What it is.** A ~9 KB prompt-only design skill (Apache-2.0): pick a direction from the product's subject, avoid five
"AI-default" looks, plan a compact token system before coding, meet a quality floor (responsive, focus, reduced motion),
copy rules for errors and empty states. The installed `frontend-design@claude-plugins-official` is byte-identical.

**Executable surface.** None.

**Companion, pinned, with precedence (THEME-12).** Its taste guidance is valuable and doesn't exist in the standard; its
mechanics conflict, so THEME-12 makes §6A the brief:

| frontend-design | Standard | Resolution (THEME-12) |
|---|---|---|
| "describe the core base palette as 4–6 named hex values"; "create a compact token system" | THEME-1/2/4/8: one DTCG source, semantic names, no hex in screens | propose values for the existing semantic tokens |
| typefaces chosen per brief, source unstated | PERF-16 / WEB-6 self-hosted WOFF2, ≤ 2 families | self-hosted, ≤ 2 |
| "visually accessible" — no ratios, no dark mode | THEME-7 AA in light and dark at build | validated by the kit |
| empty/error copy guidance, no loading state | UX-1 four states | four states required |
| "the brief's own words always win" | — | the hook the precedence uses |

**Pin.** Marketplace plugins update automatically; `sources-weekly` watches `skills/frontend-design/` and opens an issue on
any change.

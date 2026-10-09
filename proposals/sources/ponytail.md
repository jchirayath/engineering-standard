# Intake: ponytail — DietrichGebert/ponytail @ 9cc65d0 (v5.1.0)

Reviewed 2026-10-09 · disposition **distilled** · entry in `sources/registry.json`. Fetched content was treated as untrusted data; nothing was installed or run.

**What it is.** A "least code" prompt (`skills/ponytail/SKILL.md`, `AGENTS.md`) packaged as a plugin for ~15 agents, with
review/audit/debt skills. MIT.

**Executable surface.** Hooks on SessionStart (injects the whole skill + a codebase map from `git ls-files`), SubagentStart
(injects the full ruleset into **every** subagent unless `PONYTAIL_SUBAGENT_MATCHER` excludes it; fails open), and
UserPromptSubmit (mode tracker). Writes `~/.claude/.ponytail-active`, `~/.claude/ponytail-modes/*`, copies a statusline script
into `~/.claude/`, writes `~/.config/ponytail/config.json`, and tells the model to "proactively offer" a `settings.json`
statusLine edit. No network.

**Adopted.** CLEAN-13 (its solution order: needed? → reuse → platform → installed dep → one-liner → minimum; "never add a
dependency for a few lines"; deletion beats addition) with an explicit never-cut list tied to the mode. CLEAN-5 `shortcut:`
comments (with an issue link) and the grep-able debt ledger. AGT-14 "grep every caller, fix the root cause once".
APP_REVIEW §7: no concrete case → no finding; grep the whole tree before calling code unused; numbered findings; a Lean line.

| Ponytail | Standard | Resolution |
|---|---|---|
| "one small test or an assert-based self-check"; trivial changes none | TEST-14 / TEST-0 | mode's tests are in CLEAN-13's never-cut list |
| never-cut list omits help, logging, docs | HELP-*, LOG-5/6 (client) | named in CLEAN-13 for client mode |
| "You are a lazy senior developer" (persona) | Instruction-files rule: no personas | not loaded |
| subagent injection on by default | standard-reviewer returns JSON only; AGT-9 | not installed |
| `ultra` pushes back on requirements | AGT-11 clarify, never weaker than the mode | AGT-11 |
| `/ponytail-review` defaults to "Looks good. Ship." | APP_REVIEW Prime Directive: default INCOMPLETE | review ideas distilled only |

**Not verified:** whether Claude Code loads its `.toml` commands; whether SubagentStart carries `agent_type`.

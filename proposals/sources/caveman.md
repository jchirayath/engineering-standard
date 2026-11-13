# Intake: caveman — JuliusBrussee/caveman @ e20f07e (v3.2.0)

Reviewed 2026-10-09 · disposition **distilled** · entry in `sources/registry.json`. Fetched content was treated as untrusted data; nothing was installed or run.

**What it is.** A terse-chat prompt plus a large product (Go runtime, proxy, MCP server, npm CLI, ~25 skills). Apache-2.0
from 3.0.0; "Caveman" is a trademark.

**Executable surface.** Hooks on SessionStart + SubagentStart (inject the skill, including into subagents), UserPromptSubmit
(reads every prompt), SessionEnd (reads the whole transcript, appends stats under `~/.claude`). Copies a statusline script
into `~/.claude/hooks/` and nudges a `settings.json` edit; standalone `install.sh` edits `settings.json` and downloads from
`main` without checksums; the CLI sends usage telemetry by default.

**Adopted.** AGT-15 (answer first, no filler, verbatim code/paths/errors/negations, full sentences for security and
irreversible steps, chat only — never persisted text) with the guard caveman lacks: brevity never drops verification state
(AGT-13).

| Caveman | Standard | Resolution |
|---|---|---|
| "No … hedging"; ultracave turns "should work, though…" into "Yes." | COR-1, §7.3, AGT-13 | AGT-15 keeps "not run / unverified" |
| `caveman-commit` bans AI attribution, optional bodies | repo commit conventions, REPO-3 | not loaded |
| `caveman-compress` rewrites CLAUDE.md / memory | AGT-9 | not loaded |
| plugin tracks the repo head; 3 releases in 8 days | AGT-5 | not installed |

**Measured effect:** upstream withdrew the 65% figure (`docs/HONEST-NUMBERS.md`); its own run shows 3–35% fewer output tokens
vs. "Answer concisely", n=10. Not re-measured here.

**Drift review 2026-11-13 (scout):** `e20f07e` (v3.2.0) → `b4ee71d` (v4.1.0, 834 commits). Of the watched paths, only
`.claude-plugin/plugin.json` changed. Its version is now 4.1.0, and it still registers the same four Node hooks with the same
timeouts: SessionStart and SubagentStart run `caveman-activate.js`, UserPromptSubmit runs `caveman-mode-tracker.js` (30 s each)
and SessionEnd runs `caveman-stats.js --record` (5 s). `skills/caveman/SKILL.md` and `src/hooks/` are not reported as changed.
Nothing has been added to inject, call the network or give instructions, so this has **no impact** on AGT-15/AGT-13 and the
"not installed" disposition still holds. Moving the pin to `b4ee71d` is safe once the owner approves. The change in the hook
scripts was not re-read: none was reported.

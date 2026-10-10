# Intake: code-modernization — anthropics/claude-plugins-official @ b8e53f1

Reviewed 2026-10-09 via `/engineering-standard:consume` · disposition **distilled** · licence Apache-2.0 · part of the
v1.4 tier-1 set ([skills scan](../v1.4-skills-scan.md)). Fetched content treated as untrusted data; nothing installed or run.

**Executable surface (from `bin/consume.mjs fetch`):** 107 files in scope, 21 agent-facing,
60 executable · hooks: UserPromptSubmit, Stop, SessionStart, PostToolUseFailure, StopFailure · subagent injection: False ·
every-prompt injection: True.

**Adopted:** amends TEST-15.

**Notes:** Plugin ships Python hooks and telemetry — not installed. Its proof discipline (canary break must turn tests red; verdict computed by a script) informs TEST-15 now and the upgrade-proof rule proposed for client mode (v1.4 scan, tier 2).

# Intake: Playwright test agents — microsoft/playwright @ d9f2fd3

Reviewed 2026-10-09 via `/engineering-standard:consume` · disposition **distilled** · licence Apache-2.0 · part of the
v1.4 tier-1 set ([skills scan](../v1.4-skills-scan.md)). Fetched content treated as untrusted data; nothing installed or run.

**Executable surface (from `bin/consume.mjs fetch`):** 11 files in scope, 8 agent-facing,
2 executable · hooks: none · subagent injection: False ·
every-prompt injection: False.

**Adopted:** amends AGT-8.

**Notes:** The healer agent is told 'Do not ask user questions' and to mark an unfixable test test.fixme() — the opposite of AGT-8; its generator guidance (role-based locators, no networkidle) agrees with the standard.

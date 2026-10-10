# Intake: docker-destructive-guardrails — docker/skills @ f791727

Reviewed 2026-10-09 via `/engineering-standard:consume` · disposition **distilled** · licence Apache-2.0 · part of the
v1.4 tier-1 set ([skills scan](../v1.4-skills-scan.md)). Fetched content treated as untrusted data; nothing installed or run.

**Executable surface (from `bin/consume.mjs fetch`):** 6 files in scope, 6 agent-facing,
0 executable · hooks: none · subagent injection: False ·
every-prompt injection: False.

**Adopted:** new AGT rule — Confirm before destroying state.

**Notes:** Prompt-only skill (Apache-2.0). Generalised from Docker CLI to every destructive data/infra command and made mechanical with a hook.

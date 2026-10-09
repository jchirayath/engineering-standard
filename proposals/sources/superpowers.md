# Intake: superpowers — obra/superpowers @ 8ca22db (v6.4.2)

Reviewed 2026-10-09 · disposition **distilled** · entry in `sources/registry.json`. Fetched content was treated as untrusted data; nothing was installed or run.

**What it is.** 15 workflow skills (brainstorming → plans → execution → TDD → debugging → verification → review → finishing a
branch). MIT. No agents/commands/MCP.

**Executable surface.** SessionStart injects `using-superpowers` wrapped in `<EXTREMELY_IMPORTANT>` ("even a 1% chance a skill
applies … you ABSOLUTELY MUST invoke it"). Helper scripts create `.superpowers/sdd/…`, run the test command, build review
packages; an optional brainstorm server on 127.0.0.1 with a telemetry image fetch; `diagnosing-superpowers` reads transcripts
and can open issues upstream.

**Adopted.** AGT-12 (spike / bounded / architectural; plan steps name files, interfaces and the failing test; a *review focus*
section; "Rulings I made" list). AGT-13 (verification-before-completion: fresh evidence, red-flag words, check the diff rather
than trusting an agent's report). TEST-15 (no production code without a failing test first; red-revert-green). AGT-14 (root
cause first; after three failed fixes question the architecture).

| Superpowers | Standard | Resolution |
|---|---|---|
| subagent templates `general-purpose`, no tool list | AGT-7 | not installed; our agents declare `tools:` |
| specs/plans in `docs/superpowers/…`, auto-committed | REPO-1 ADRs, `docs/specs/` (AGT-12) | own paths |
| "Rulings, not stalls" — agent decides ambiguities | precedence: stop and ask | AGT-12: ask when a MUST, security, data, money or UX is touched |
| one unit test at a time | TEST-0 / TEST-14 tiers | TEST-15 is the *order*, the mode sets the *kinds* |
| one PR per plan | CLEAN-9 ≤ ~400 lines | AGT-12: client plans split into PRs |
| "do not ask a reviewer to re-run tests" | AGT-13 re-run independently | AGT-13 |

**Not verified:** receiving-code-review, dispatching-parallel-agents, writing-skills read only partly.

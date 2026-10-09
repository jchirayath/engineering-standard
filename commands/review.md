---
description: Run an APP_REVIEW.md review (quick | standard | full) with read-only standard-reviewer agents
argument-hint: "[quick|standard|full] [scope]"
allowed-tools: Agent, Read, Grep, Glob, mcp__plugin_engineering-standard_standard__review_plan, mcp__plugin_engineering-standard_standard__check, mcp__plugin_engineering-standard_standard__mode
---

1. Call `review_plan` with the profile from `$ARGUMENTS`; with none, omit it so the repo's mode picks it
   (quick → `quick`, client → `standard`).
2. Launch one `engineering-standard:standard-reviewer` agent per lens in the plan (in parallel), passing the lens key, the
   plan's preamble, the repo path, the mode and the scope. One lens per agent.
3. Verify every P0/P1 claim yourself (open the cited file:line) before reporting it.
4. Report: P0s first, then a table of findings by lens with `standard_ref`, and the ship verdict per
   APP_REVIEW.md §9–10. Write files only if the user asks.

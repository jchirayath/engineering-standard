---
description: Record a standard exception (rule, reason, owner, expiry) in docs/STANDARD_EXCEPTIONS.md
argument-hint: "<RULE-ID> <owner> <YYYY-MM-DD> <reason…>"
allowed-tools: mcp__plugin_engineering-standard_standard__exception_add, mcp__plugin_engineering-standard_standard__rule
---

1. Parse `$ARGUMENTS` into rule ID, owner, expiry (future ISO date) and reason; ask for anything missing.
2. Call `rule` for the ID and confirm with the user that the exception is justified (a MUST rule needs a
   compensating control — say which).
3. Call `exception_add` with `repo_path` set to the repo root and show the row that was added.

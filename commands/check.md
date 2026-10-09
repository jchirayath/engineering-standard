---
description: Run the standard's kit checks on this repo (or given paths) and report findings by rule ID
argument-hint: "[paths…]"
allowed-tools: Bash(tools/standard/check.sh:*), mcp__plugin_engineering-standard_standard__check, mcp__plugin_engineering-standard_standard__rule
---

1. If `tools/standard/check.sh` exists, run it and paste the real output; otherwise call the MCP
   `check` tool with `paths: [$ARGUMENTS]` (default `["."]`).
2. Group findings by rule ID; for each distinct ID call `rule` once and give the one-line fix.
3. State plainly which checks did not run (e.g. semgrep not installed) — never report "should pass".

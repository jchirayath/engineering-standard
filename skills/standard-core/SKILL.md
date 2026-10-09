---
name: standard-core
description: This skill should be used when writing or reviewing application code in a repo that follows the engineering standard — "add an endpoint", "implement auth", "add logging", "handle errors", "add a feature", "write tests for", "is this compliant", "which standard rule", or any mention of ENGINEERING_STANDARD.md or a rule ID like SEC-4 or LOG-2. Fetches the stack-scoped rules from the standard MCP server instead of guessing.
---

# Engineering standard — core

The rules live in one place — `ENGINEERING_STANDARD.md`, compiled to `build/rules.json`. This skill
holds no rule text; fetch the rules, apply them, cite their IDs.

## Fetch the applicable rules

1. Call the MCP tool `rules_for` (server `standard`, full name
   `mcp__plugin_engineering-standard_standard__rules_for`) with `stacks: ["all"]` and a `topic` naming
   what is being changed (e.g. "auth session", "logging audit", "pagination", "tests"). Add the repo's stacks (the SessionStart context lists them) to include their rules.
2. Call `rule` with each ID that the change touches to get its full text, ASVS mapping and enforcement.
3. Without the MCP server, read the same data directly:
   `node -e 'const r=require(process.argv[1]).rules;console.log(r.filter(x=>x.stacks.some(s=>["all"].includes(s))).map(x=>x.id+" "+x.levelText+" — "+x.title).join("\n"))' "${CLAUDE_PLUGIN_ROOT}/build/rules.json"`

## Apply

- Reuse the platform-core module for each concern (CORE-* rules) before writing a second implementation.
- Add a dependency only after `verify_dependency` returns `ok` (SEC-31).
- **MUST** rules are blocking. A deviation needs an exception (`exception_add` tool or
  `/engineering-standard:exception`) with owner and expiry — never a silent skip.
- Cite rule IDs in code review notes, PR descriptions and commit messages for the change.
- Finish with the real output of the repo's tests and `tools/standard/check.sh` (or the `check` tool).

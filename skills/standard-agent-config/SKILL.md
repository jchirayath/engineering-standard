---
name: standard-agent-config
description: This skill should be used when configuring coding agents or their harness — "edit .claude/settings.json", "add a subagent", "add an MCP server", "set up hooks", "headless claude -p in CI", "permissions deny", "sandbox", "bypass permissions", or edits to CLAUDE.md, .claude/** or .mcp.json. Fetches the AGT-* agent rules from the standard MCP server.
---

# Engineering standard — agent configuration

The rules live in one place — `ENGINEERING_STANDARD.md`, compiled to `build/rules.json`. This skill
holds no rule text; fetch the rules, apply them, cite their IDs.

## Fetch the applicable rules

1. Call the MCP tool `rules_for` (server `standard`, full name
   `mcp__plugin_engineering-standard_standard__rules_for`) with `stacks: ["agent"]` and a `topic` naming
   what is being changed (e.g. "permissions deny", "subagent tools", "mcp pin", "headless"). Add `include_core: false` to see only the stack-specific rules.
2. Call `rule` with each ID that the change touches to get its full text, ASVS mapping and enforcement.
3. Without the MCP server, read the same data directly:
   `node -e 'const r=require(process.argv[1]).rules;console.log(r.filter(x=>x.stacks.some(s=>["agent"].includes(s))).map(x=>x.id+" "+x.levelText+" — "+x.title).join("\n"))' "${CLAUDE_PLUGIN_ROOT}/build/rules.json"`

## Apply

- Every project subagent declares a `tools:` allow-list; review agents stay read-only (see the AGT rules for the exact bar).
- Secret files stay unread even when a task seems to need them; the plugin hooks block them.
- **MUST** rules are blocking. A deviation needs an exception (`exception_add` tool or
  `/engineering-standard:exception`) with owner and expiry — never a silent skip.
- Cite rule IDs in code review notes, PR descriptions and commit messages for the change.
- Finish with the real output of the repo's tests and `tools/standard/check.sh` (or the `check` tool).

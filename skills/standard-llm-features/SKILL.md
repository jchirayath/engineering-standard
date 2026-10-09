---
name: standard-llm-features
description: This skill should be used when adding or changing an LLM/AI feature inside an app — "call the Claude/OpenAI API", "add a chatbot", "RAG", "tool calling", "prompt", "structured output", "AI disclosure", "model id", or code importing an LLM SDK. Fetches the AI-* and SEC-19 rules from the standard MCP server.
---

# Engineering standard — LLM features in apps

The rules live in one place — `ENGINEERING_STANDARD.md`, compiled to `build/rules.json`. This skill
holds no rule text; fetch the rules, apply them, cite their IDs.

## Fetch the applicable rules

1. Call the MCP tool `rules_for` (server `standard`; it returns the repo's mode — quick or client — only; full name
   `mcp__plugin_engineering-standard_standard__rules_for`) with `stacks: ["llm"]` and a `topic` naming
   what is being changed (e.g. "structured output", "token budget", "prompt injection", "consent"). Add `include_core: false` to see only the stack-specific rules.
2. Call `rule` with each ID that the change touches to get its full text, ASVS mapping and enforcement.
3. Without the MCP server, read the same data directly:
   `node -e 'const r=require(process.argv[1]).rules;console.log(r.filter(x=>x.stacks.some(s=>["llm"].includes(s))).map(x=>x.id+" "+x.levelText+" — "+x.title).join("\n"))' "${CLAUDE_PLUGIN_ROOT}/build/rules.json"`

## Apply

- Treat model output as untrusted input and keep tool privileges minimal; the rule text says exactly how.
- **MUST** rules are blocking. A deviation needs an exception (`exception_add` tool or
  `/engineering-standard:exception`) with owner and expiry — never a silent skip.
- Cite rule IDs in code review notes, PR descriptions and commit messages for the change.
- Finish with the real output of the repo's tests and `tools/standard/check.sh` (or the `check` tool).

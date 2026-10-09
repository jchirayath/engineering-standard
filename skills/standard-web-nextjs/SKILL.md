---
name: standard-web-nextjs
description: This skill should be used when building or changing a web front end, a Next.js app or a static website — "add a Server Action", "add a route handler", "configure next.config", "set security headers", "add CSP", "deploy the site", "optimise LCP", "add a npm package", or work in a repo with next/react/vite in package.json. Fetches web, Next.js, npm and website rules from the standard MCP server.
---

# Engineering standard — web, Next.js, websites

The rules live in one place — `ENGINEERING_STANDARD.md`, compiled to `build/rules.json`. This skill
holds no rule text; fetch the rules, apply them, cite their IDs.

## Fetch the applicable rules

1. Call the MCP tool `rules_for` (server `standard`, full name
   `mcp__plugin_engineering-standard_standard__rules_for`) with `stacks: ["web","nextjs","node","website"]` and a `topic` naming
   what is being changed (e.g. "server action", "headers csp", "images", "cache"). Add `include_core: false` to see only the stack-specific rules.
2. Call `rule` with each ID that the change touches to get its full text, ASVS mapping and enforcement.
3. Without the MCP server, read the same data directly:
   `node -e 'const r=require(process.argv[1]).rules;console.log(r.filter(x=>x.stacks.some(s=>["web","nextjs","node","website"].includes(s))).map(x=>x.id+" "+x.levelText+" — "+x.title).join("\n"))' "${CLAUDE_PLUGIN_ROOT}/build/rules.json"`

## Apply

- For websites, run the kit site checks the rules name (`site/check-build.mjs` before deploy, `site/check-site.mjs` after).
- **MUST** rules are blocking. A deviation needs an exception (`exception_add` tool or
  `/engineering-standard:exception`) with owner and expiry — never a silent skip.
- Cite rule IDs in code review notes, PR descriptions and commit messages for the change.
- Finish with the real output of the repo's tests and `tools/standard/check.sh` (or the `check` tool).

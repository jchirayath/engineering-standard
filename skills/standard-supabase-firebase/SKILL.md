---
name: standard-supabase-firebase
description: This skill should be used when working on a Supabase or Firebase backend — "add an RLS policy", "write a migration", "security definer function", "edge function", "Firestore rules", "App Check", "storage bucket", "service_role / sb_secret key", or work in a repo with supabase/ or firebase.json. Fetches Supabase, Firebase and data-access rules from the standard MCP server.
---

# Engineering standard — Supabase & Firebase

The rules live in one place — `ENGINEERING_STANDARD.md`, compiled to `build/rules.json`. This skill
holds no rule text; fetch the rules, apply them, cite their IDs.

## Fetch the applicable rules

1. Call the MCP tool `rules_for` (server `standard`, full name
   `mcp__plugin_engineering-standard_standard__rules_for`) with `stacks: ["supabase","firebase"]` and a `topic` naming
   what is being changed (e.g. "rls policy", "keys", "app check", "migration"). Add `include_core: false` to see only the stack-specific rules.
2. Call `rule` with each ID that the change touches to get its full text, ASVS mapping and enforcement.
3. Without the MCP server, read the same data directly:
   `node -e 'const r=require(process.argv[1]).rules;console.log(r.filter(x=>x.stacks.some(s=>["supabase","firebase"].includes(s))).map(x=>x.id+" "+x.levelText+" — "+x.title).join("\n"))' "${CLAUDE_PLUGIN_ROOT}/build/rules.json"`

## Apply

- Pair with `supabase:supabase-postgres-best-practices` for Postgres specifics; the standard decides what is required.
- **MUST** rules are blocking. A deviation needs an exception (`exception_add` tool or
  `/engineering-standard:exception`) with owner and expiry — never a silent skip.
- Cite rule IDs in code review notes, PR descriptions and commit messages for the change.
- Finish with the real output of the repo's tests and `tools/standard/check.sh` (or the `check` tool).

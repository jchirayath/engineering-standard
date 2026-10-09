---
description: Adopt (or upgrade) the engineering-standard kit in this repo
argument-hint: "[--site swa|netlify|apache|caddy|nginx --url https://…]"
allowed-tools: Bash(tools/standard/check.sh:*), Read, Edit, Write
---

Adopt the standard kit into the current repository.

1. Run `bash ${CLAUDE_PLUGIN_ROOT}/bin/adopt.sh . $ARGUMENTS` and show its output.
2. For an existing repo with code, run `tools/standard/check.sh --baseline` so only new violations fail
   (ENF-1); for a new repo run `tools/standard/check.sh`. Paste the real output.
3. Make sure `.claude/settings.json` satisfies AGT-1 (deny reads of `.env*`, `secrets/**`, `~/.ssh/**`,
   production config; `permissions.disableBypassPermissionsMode: "disable"`) — fetch the exact rule with
   the MCP `rule` tool (`AGT-1`) and merge, never overwrite, existing settings.
4. Add the CLAUDE.md line that adopt.sh prints, then list the follow-ups it printed (tokens, CI job).

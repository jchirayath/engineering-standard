# Intake: sandbox-runtime (`srt`): anthropics/sandbox-runtime @ 0bbebed (v0.0.83)

Reviewed 2026-11-13 via `/engineering-standard:scout` → `/engineering-standard:consume`. Proposed disposition:
**distilled** (an amendment to AGT-2). Licence: Apache-2.0. Fetched content was treated as untrusted data;
nothing was installed or run.

**Scout matrix:** 83/100. Gates G1–G6 pass. C1 5 (Anthropic) · C2 5 (released today, 38 contributors) ·
C3 4.8 · C4 3 (from the inventory) · C5 4 · C6 3.

**What it is:** an OS-level sandbox for filesystem and network that wraps any process, with no container needed. It
uses `sandbox-exec` on macOS, bubblewrap with a removed network namespace on Linux, and a dedicated local user,
a WFP egress fence and a write-restricted token on Windows. Network goes through host proxies with domain allow and
deny lists. It is the same mechanism Claude Code's own Bash sandbox uses.

**Executable surface (`bin/consume.mjs fetch`):** 381 files: 0 agent-facing, 237 executable, no agent hooks, no MCP
server. `package.json` has a `prepare` script (`husky`, used for development only, not run by `npm install -g` of
the published package). The network hosts in the code are test fixtures (`*.invalid`, `example.*`). The vendored
Windows Rust sources are beyond the 200-file read cap; I didn't read them. It is pre-1.0 with 325 open issues
and one past advisory (GHSA-9gqj-5w7c-vx47, low, network escape, 2025-12, fixed).

**Gap it fills:** AGT-2 makes Bash sandboxed only *where Claude Code's sandbox is supported*. Agents without a
built-in sandbox, such as headless runners (AGT-6), other agent CLIs and local stdio MCP servers, have no
OS-level containment today. They rely on permissions alone (AGT-1) or a full container (AGT-3).

**Adopted:** an amendment to AGT-2 (see `anthropic-sandbox-runtime.rules.json`). Agent processes and local MCP
servers that have no built-in sandbox run inside an OS-level sandbox, under the same allow-list and deny rules,
from a pinned version.

| Conflict | Source says | Standard says | Resolution |
|---|---|---|---|
| Unpinned MCP launch | README examples wrap `npx -y @modelcontextprotocol/server-filesystem` | AGT-5: stdio packages pinned to an exact version, never bare `npx -y` | The standard wins: the amendment requires the sandboxed command to be pinned too |
| Global install | `npm install -g @anthropic-ai/sandbox-runtime` (latest) | NPM-1 / SUP-1: exact version, not brand-new | Install an exact version (`@anthropic-ai/sandbox-runtime@0.0.83`), allowed by the plugin's `verify_dependency` |

**Not verified:** the Windows backend (not read). Whether every release has provenance attestations. Behaviour with
Docker inside the sandbox (the README marks `docker` as weak isolation, consistent with AGT-2's `excludedCommands` rule).

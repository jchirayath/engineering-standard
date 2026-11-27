# Intake: Jentic One: jentic/jentic-one @ 368ce63 (v0.45.1 line)

Reviewed 2026-11-27 via `/engineering-standard:scout` → `/engineering-standard:consume` (unattended run, stopped at
the proposal). Proposed disposition: **distilled** (one tool-agnostic amendment to AGT-4). Fetched content was
treated as untrusted data; nothing was installed or run.

**Licence:** Apache-2.0. **Scout matrix:** 70/100 after the fetch (consume, at the threshold). Gates G1–G6 pass. C1 4
(verified org) · C2 5 · C3 2.9 (228★) · C4 3 (from the inventory: remote-instruction and code network hosts, hooks
unknown) · C5 3 · C6 3.

**What it is:** a self-hosted execution layer between agents and third-party APIs. The control plane registers
APIs (from a public catalogue of OpenAPI specs), stores credentials encrypted at rest and approves agents. The
Broker, a transparent forward proxy, checks per-binding permission rules (`allow`/`deny` on methods, path regex and
operation id, first match wins), injects the stored credential, forwards the call and writes an append-only
execution record. Denied calls get a 403 and never leave the Broker. v0.44 added a "require-approval" tier that holds
a call until a human approves it.

**Executable surface (`bin/consume.mjs fetch`):** 3,980 files, 3,077 executable, 11 agent-facing; **2,899 files not
read** (fetch limit), and hooks could not be inventoried automatically. Manual check: the files listed as "hooks" are
React hooks and a perf-test `sitecustomize.py`. There are no Claude Code hooks, and no install scripts.
- Agent-facing, shipped to users: `skills/jentic/SKILL.md` + `references/{cli,mcp,recovery}.md`, installed by
  `jentic setup`. No frontmatter hooks, no `` !`cmd` ``. It tells the agent to stop and relay to its operator when
  it is unregistered or unapproved, never to grant itself access, never to re-send a held call, and to stop when a
  request is rejected. It also says an approved agent holds `catalog:import` **by default**, so it can add
  catalogued APIs without a human.
- Agent-facing, contributor-only: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/git-conventions.mdc`,
  three dev skills (`contribute-spec-fix`, `import-new-api`, `init-design`) and a `.claude/settings.json` allow-list
  (`make …`, `uv run …`, read-only git). These matter only to people working on Jentic's own repo.
- Network: anonymous telemetry is off in the backend default, but "the shipped install examples and the interactive
  installer turn it on" (closed schema: id, version, event, OS family; "no credentials, request data, or PII"). The
  quickstart pulls a compose file from `raw.githubusercontent.com`. Most code hosts are test fixtures
  (`api.example.com`, `evil.example`, `httpbin.org`).
- Install: docker compose, Homebrew cask `jentic/tap/jentic`, scoop, Helm, systemd. Releases are 0.x with breaking
  changes (v0.45.0 was tagged but never published, and `jentic run` was removed).

**Gap it fills:** AGT-1 keeps secret files out of agent reads, AI-5 keeps credentials out of prompts, and AGT-4
removes one leg of the trifecta. None of them says how an agent that **must** call authenticated APIs should hold the
credentials. Today the usual answer is an API key in the agent's environment, which a prompt-injected agent can read
and send out. Brokered injection removes the credential from the private-data leg.

**Adopted:** an amendment to AGT-4, stated without naming a product (as with the owner's 2026-11-13 harden-runner
decision). Credentials are injected by a broker under a different OS user, container or host, with per-agent method
and path allow-lists and a log of every call. The raw key is never in the agent's environment, files or context.
Body-field constraints are recorded as unenforced. Two conditions come from Jentic's own documentation: SECURITY.md
says the guarantee "holds on the network, but **not** when the agent runs as the same OS user as the broker", and the
skill says rules match "the request's HTTP method, URL path, and OpenAPI operation id — never the request body".

**Not adopted:** Jentic itself, as a companion or a recommended install. It is a public beta with breaking 0.x
releases, its shipped installers turn telemetry on, and agents can import catalogued APIs by default.

| Conflict | Source says | Standard says | Resolution |
|---|---|---|---|
| Telemetry | installer and examples enable anonymous telemetry | AGT-5: record every network destination; PRIV-2 | recorded here; not adopted |
| Agent self-service | approved agents hold `catalog:import` by default and can start connection requests | SEC-19 / AGT-4: least privilege for model-driven tools | the amendment only covers credential custody; an adopter would remove `catalog:import` from agents |
| Same-user deployment | the CLI and broker can run as the agent's user (dev quickstart) | — | the amendment excludes it explicitly |
| Install | compose file fetched from `raw.githubusercontent.com` on `main` | AGT-5 / SEC-15: pinned versions | not adopted, so not applicable |

**Overlaps:** fwdai/rowel (watch, 67) uses the same pattern as a local desktop vault (`rowel run/proxy`, approved
grants). agent-passport-system (watch, 56) is delegation and authority, not credential custody. AGT-2's dummy-secret
environment for code review is related but covers a different case.

**Not verified:** the Broker's code (most of `src/jentic_one/broker/` was over the fetch limit), so the injection,
isolation and SSRF guard (`shared/url_validation.py`) are taken from the docs; `docs/security/README.md` (the
deployment-tier ladder) was not in the fetch; the hosted (`remote`) offering and what it sends; whether the
similarity check flags the amendment against AGT-1, AI-5 or AGT-2 (that runs when it is applied); the classifier's
quick/client view of the amendment (it inherits AGT-4's quick mode). README and release details came partly through
a fetch agent's summary.

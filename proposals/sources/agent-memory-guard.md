# Intake: agent-memory-guard: OWASP/www-project-agent-memory-guard @ 2628cfd (main)

Reviewed 2026-11-25 by the scheduled scout → `/engineering-standard:consume` (unattended run, stopped at the
proposal). Proposed disposition: **distilled** (one amendment to AI-5). Fetched content was treated as untrusted
data, and nothing was installed or run.

**Licence:** Apache-2.0. **Scout matrix:** 77/100 after the fetch (74 before it). Gates G1–G6 pass (OWASP is a trusted
vendor). C1 5 · C2 5 · C3 2.9 · C4 4 (from the inventory) · C5 3 · C6 3.

**What it is:** The OWASP project for agent memory poisoning (OWASP Agentic Top 10, ASI06). It is a Python library
that wraps an agent's memory store (`MemoryGuard.write` / `read`). Detectors cover injection, secret and PII leakage,
protected keys, self-reinforcement, standing directives from untrusted sources, cross-task leakage and size
anomalies. A YAML policy maps each finding to allow, redact, quarantine or block, and SHA-256 baselines plus
snapshots support rollback. Adapters exist for LangChain, OpenAI Agents, AutoGen, CrewAI, LlamaIndex, Agno and mem0.
There is also a SARIF scanner, a GitHub Action, an optional HTTP server and a separate MCP server
(`amg-mcp-server`). Install is `pip install agent-memory-guard`, unpinned in the docs.

**Executable surface (`bin/consume.mjs fetch`):** 903 files, 134 executable, 0 agent-facing. There are no hooks, no
install scripts, no symlinks and no plugin manifest.
- **Network:** grep found no `requests`, `httpx`, `urllib`, socket, subprocess or telemetry library in `src/`,
  `scanner/` or `mcp-server/`. The inventory's three hosts are a CORS comment (`console.internal`), SARIF `helpUri`
  links (`owasp.org`) and a test fixture (`zoom.us`).
- **Optional `[ml]` extra:** `detectors/ml_injection.py` calls `transformers.pipeline` with
  `protectai/deberta-v3-base-prompt-injection-v2` and falls back to `deepset/deberta-v3-base-injection`. That is a
  Hugging Face model download at first use, by name and not pinned to a revision.
- **Auto-run tests:** 50 pytest files (normal for a library). None of them run from an agent.

**Gap it fills:** AGT-9 bans copying untrusted text into the coding agent's own memory files, and AGT-4 removes a
trifecta leg. No AI-* rule covers an app's own agent that keeps memory across sessions, where a retrieved web page
or tool result can plant "from now on…" instructions that steer later sessions or reach another user.

**Adopted (the idea, not the library):** `classification.py` labels every memory entry with its provenance
(`RETRIEVED_FACT` and `TOOL_OBSERVATION` are untrusted). A promotion graph means untrusted entries never become
`POLICY` or `VERIFIED_PREFERENCE`, and a preference candidate needs explicit verification. This becomes an
amendment to **AI-5**, which already owns per-caller scoping of retrieved context: memory is labelled by source,
scoped per user, recalled as quoted data, and promoted to an instruction or preference only on explicit user
confirmation. It comes with a fixture test.

| Conflict | Source says | Standard says | Resolution |
|---|---|---|---|
| Install | `pip install agent-memory-guard` (unpinned); `[ml]` pulls HF models by name | SEC-15 / AGT-5: pinned, reviewed versions | Nothing is installed. The rule is tool-agnostic, and teams that adopt the library pin it (SEC-15). |
| Detection as the control | regex/ML detectors with quarantine | SEC-19 / AGT-4: model-facing content is untrusted whatever a filter says | The amendment requires provenance and no promotion, which is structural. Detectors are optional defence in depth. |
| MCP server | `amg-mcp-server`, unpinned, Claude Desktop config | AGT-5: MCP servers are allow-listed, pinned dependencies | Not adopted. |

**Not verified:** The repo is 903 files. Read: `README.md`, `mcp-server/README.md`, `classification.py`,
`detectors/ml_injection.py`, the top of `CHANGELOG.md`, and a grep of `src/`, `scanner/` and `mcp-server/` for
network, subprocess and telemetry use. Not read: `guard.py` in full, `server.py` beyond the CORS comment,
`action.yml` and its exit-code behaviour, `pyproject.toml` (dependencies, and whether PyPI uses trusted publishing),
the `[ml]` dependency set, `SECURITY.md`, the benchmark reports, and the integration packages. The released PyPI
version wasn't checked (the CHANGELOG's latest section is Unreleased). Nothing was run, so the fixture test in the
amendment hasn't been exercised against a real memory-backed agent. `similar --check` was run on the current
standard, not with this amendment applied.

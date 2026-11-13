# Intake: SkillSpector: NVIDIA/SkillSpector @ ce46d46 (v2.13.4 line)

Reviewed 2026-11-13 via `/engineering-standard:scout` → `/engineering-standard:consume` (unattended run, stopped at
the proposal). Proposed disposition: **distilled** (one amendment to AGT-5, alongside cisco-skill-scanner). Fetched
content was treated as untrusted data; nothing was installed or run.

**Licence:** Apache-2.0. **Scout matrix:** 75/100 after the fetch. Gates G1–G6 pass. C1 5 (trusted vendor `nvidia`)
· C2 5 · C3 5 · C4 3 (from the inventory) · C5 3 · C6 2.

**What it is:** a scanner for agent skills (Claude Code, Codex, Gemini CLI, MCP). Stage 1 is static: 71 patterns in
17 categories, Python AST, taint tracking, YARA, and MCP least-privilege and tool-poisoning checks. Stage 2 is an
optional LLM review. It outputs JSON, Markdown and SARIF 2.1.0, and its exit codes support CI gates
(`--fail-on-findings`, `--fail-on-incomplete`, `--min-coverage`). It can also diff MCP registry snapshots.

**Executable surface (`bin/consume.mjs fetch`):** 581 files, 447 executable, 35 agent-facing, no agent hooks, no
install scripts. **263 files were not read** (the fetch's 200-file limit), so the signals are incomplete.
- Agent-facing: `skills/skill-inspector/SKILL.md` (a review workflow that keeps `--no-llm` unless the user asks,
  never runs target scripts, and ends with APPROVE / CAUTION / REJECT), `.opencode/commands/skillspector.md`, and
  33 `tests/fixtures/**/SKILL.md` that are deliberately malicious samples.
- Network: LLM providers (`api.anthropic.com`, `api.openai.com`, `integrate.api.nvidia.com`, Vertex AI, Groq,
  MiniMax) only with LLM review on; `api.osv.dev` for dependency checks even with `--no-llm`; package registries
  with `--inspect-dependencies`; `registry.modelcontextprotocol.io` for registry scans. `evil.example.com` /
  `example.test` are test fixtures. No phone-home telemetry found: "telemetry" in the code means local per-call
  LLM records.
- 259 pytest files would be picked up by a test runner (relevant only when the repo is cloned and tested).
- Distribution: GitHub release wheels; the releases say they do **not** publish to PyPI (`pypi.org/project/skillspector`
  returned 404). The README installs from `main` via `uv tool install git+…`, which is unpinned.

**Gap it fills (vs. cisco-skill-scanner, already in AGT-5):** an independent second detector, MCP rug-pull
detection through registry snapshot diffs (AGT-5's "re-reviewed when they change"), and explicit coverage gates. AGT-5
does not yet say what an incomplete scan means. Today a partial scan could pass as clean, which AGT-13 forbids.

**Adopted:** an amendment to AGT-5. SkillSpector, pinned to a release tag and run with `--no-llm
--fail-on-incomplete`, may replace or join the Cisco scanner. Incomplete coverage is recorded as incomplete, never
as clean.

| Conflict | Source says | Standard says | Resolution |
|---|---|---|---|
| LLM review default | the CLI runs LLM review unless `--no-llm`; providers include hosted APIs and agent CLIs | AGT-4 / AGT-5: skill text under review never goes to a hosted model | `--no-llm` is mandatory in the amendment |
| Install | `uv tool install git+https://github.com/NVIDIA/skillspector.git` (tracks `main`) | AGT-5 / SUP-6: pinned, reviewed versions | install from a release tag/commit (e.g. `@v2.13.4`); never a PyPI package named `skillspector` (not NVIDIA's) |
| OSV lookups with `--no-llm` | dependency names and versions go to api.osv.dev | AGT-5: record every network destination | recorded here; public data only, acceptable |
| MCP server mode | `skillspector mcp` registers a `scan_skill` tool (loopback HTTP, no auth) | AGT-5: MCP servers are allow-listed dependencies | not adopted; CLI only |

**Not verified:** detection quality with `--no-llm` (no vendor figure found); the 263 unread files, including
`transitive.py` and `unicode_confusables.py`; whether the release wheel matches the tagged source; the contributor
count. A side-by-side run of both scanners on the same fixtures should precede any switch of the default.

**Owner decision 2026-11-13:** applied as an *alternative* scanner, not as the new default. The paper comparison (install/pinning, network with `--no-llm`, coverage gates, MCP diffing, published detection figures) favours keeping Cisco as the default. A side-by-side run on the same fixtures is still to do; it was not performed. The tool-agnostic part, that incomplete coverage is never recorded as clean, is adopted outright.

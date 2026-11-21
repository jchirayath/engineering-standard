# Intake: SkillEvaluator: NVIDIA/SkillEvaluator @ affe1ac

Reviewed 2026-11-18 via the scheduled scout → `/engineering-standard:consume` (unattended run, stopped at the
proposal). Proposed disposition: **distilled** (one amendment to AGT-16). Fetched content was treated as untrusted
data; nothing was installed or run.

**Licence:** Apache-2.0. **Scout matrix:** 71/100 after the fetch (74 provisional; C4 fell from 3 to 2 on the
inventory). Gates G1–G6 pass. C1 5 (trusted vendor `nvidia`) · C2 5 · C3 4.4 · C4 2 · C5 3 · C6 2.

**What it is:** an experimental framework for evaluating agent skills and plugins in three tiers. Tier 1 is static
(quality score, schema, licence, Unicode, PII, script lint, a per-harness "will the agent load this skill" check, and
security via SkillSpector, Gitleaks, Bandit, optional Semgrep and pip-audit). Tier 2 finds repeated or overlapping
guidance with embeddings plus an LLM. Tier 3 runs agents in a Docker sandbox with and without the skill and has an LLM
judge score the difference. Scanners that can't run mark the result INCOMPLETE.

**Executable surface (`bin/consume.mjs fetch`):** 1231 files, 878 executable, 22 agent-facing. **664 files were not
read** (fetch limits), so the signals are incomplete.
- Hooks: the PostToolUse and SessionStart hooks the inventory found are test fixtures
  (`tests/fixtures/plugins/bundled-script-hooks/`), not hooks the tool installs.
- Agent-facing: `skills/skillevaluator/SKILL.md` (asks before installing the CLI, lists keyless commands, points LLM
  stages at `NVIDIA_API_KEY` or an OpenAI-compatible gateway) and five Tier 3 reference skills.
- Network: LLM providers for Tier 2/3 and `--llm` (NVIDIA Build by default); ghcr.io and GitHub for CI templates and
  images; docs links. 518 pytest files would run if the repo were cloned and tested.

**Gap it fills (vs. what the standard has):** most of it is already covered. AGT-5 accepts SkillSpector and the
incomplete-coverage rule, AGT-16 governs nested-agent eval loops (its skill-creator clause), and `bin/similar.mjs`
already detects overlap between this standard's rules. What's left is one idea: a skill that a target harness doesn't
load fails silently, so its guardrails quietly stop applying. A keyless, offline harness check catches that.

**Adopted:** an amendment to AGT-16. Before a skill is committed, an offline harness check confirms every target agent
loads it. `skillevaluator harness-check` from a pinned release, with no `--llm`, is the example.

| Conflict | Source says | Standard says | Resolution |
|---|---|---|---|
| LLM stages | Tier 2/3 and `--llm` send skill text to NVIDIA Build or another provider | AGT-4 / AGT-5: skill text under review never goes to a hosted model | only the keyless harness check is adopted; Tier 2/3 not adopted |
| Live eval | Tier 3 starts separate agent processes in a sandbox | AGT-16: nested-agent eval only in a throwaway worktree with explicit `--allowedTools` | unchanged; AGT-16 already governs it |
| Install | `pip install skillevaluator`, `npx skills add NVIDIA/SkillEvaluator` | AGT-5 / SUP-6: pinned, hash-locked | pinned release only; the bundled skill is not installed |
| Maturity | "Experimental", community-supported, no SLA | — | recommendation is hold until a local run on this repo's skills |

**Not verified:** the code that implements harness-check (`src/skillevaluator/tier1/plugin_checks.py` and the rest of
`tier1/` were not read); `pyproject.toml` (not fetched), so the released version and dependencies are unknown; whether
the PyPI package `skillevaluator` is NVIDIA's and matches the tagged source; whether the per-harness limits it checks
match current Claude Code behaviour; any network use in Tier 1 beyond what the README states. Nothing was run.

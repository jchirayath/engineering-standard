# Intake: garak: NVIDIA/garak @ f1c99df (main)

Reviewed 2026-11-24 via the scheduled scout → `/engineering-standard:consume` (unattended run, stopped at the
proposal). Proposed disposition: **distilled** (one amendment to AI-3). Fetched content was treated as untrusted
data; nothing was installed or run.

**Licence:** Apache-2.0. **Scout matrix:** 78/100 after the fetch (75 before it). Gates G1–G6 pass. C1 5 · C2 5 · C3 5 ·
C4 4 (from the inventory) · C5 3 · C6 2.

**What it is:** NVIDIA's LLM vulnerability scanner. A CLI (`python -m garak --target_type … --target_name … --probes …`)
sends probe prompts to a model or REST endpoint and scores the replies with detectors. Probe families include
prompt injection (`promptinject`, `latentinjection`), encoding tricks (`encoding`), jailbreaks (`dan`, `gcg`,
`goodside`), training-data leakage (`leakreplay`), package hallucination, XSS-style output and malware generation.
It writes a JSONL report, a hit log and an HTML digest grouped by OWASP LLM category. Install is `pip install garak`
(Python 3.11–3.14).

**Executable surface (`bin/consume.mjs fetch`):** 898 files, 455 executable, 1 agent-facing (`AGENTS.md`, a
contribution policy for AI-assisted PRs). There's no CLAUDE.md, skill, MCP server or plugin manifest.
- The inventory's 30 "hooks" and 194 auto-run tests belong to the React report UI (`garak-report/src/hooks`,
  `__tests__`), not agent hooks. One symlink (`garak/data/calibration/calibration.json`).
- Exit codes (read in `garak/cli.py`): `exit(1)` only on config, `--spec` or selection parse errors, interactive-mode
  exceptions and config migration. **A run whose probes succeed still exits 0.** `--eval_threshold` is the
  per-detector "minimum threshold for a successful hit", not a run-level gate.
- Network: it calls the target model (OpenAI, Bedrock, Hugging Face, LiteLLM, NIM, REST and others). Detectors may
  use a classifier "locally or via API", and huggingface.co, arxiv.org and genai.owasp.org appear in code. Grep found
  no telemetry library.

**Gap it fills:** AI-3 requires a prompt-injection eval with a pass threshold in CI but names no case set. In
practice teams write a few injections by hand and miss whole families (encoded, latent or indirect). garak is the most
widely adopted open probe set for those families.

**Adopted:** an amendment to AI-3. The injection cases include a maintained public probe set as well as the app's own
cases, run against a staging endpoint with a spend-capped key. garak, pinned to an exact version, is named only as an
example, with the note that CI has to compute the threshold from its report.

| Conflict | Source says | Standard says | Resolution |
|---|---|---|---|
| Install | `pip install -U garak` | SEC-15 / AGT-5: pinned, reviewed versions | the amendment requires an exact PyPI version |
| CI gate | report files, exit 0 on findings | AI-3: pass threshold in CI | CI fails on the hit rate from the JSONL report |
| Target | any hosted model or REST endpoint | AI-4 budgets; don't attack systems you don't operate | the team's own staging endpoint, with a spend-capped test key |

**Not verified:** 260 of 898 files were not read (200-file limit, mostly `garak/probes/*`), so which probes or
detectors download models or datasets at run time, and from where, is unknown. The docs at docs.garak.ai and the
`.githooks/` folder were not read. The latest PyPI version and whether it carries trusted-publishing provenance were
not checked. The JSONL report schema (field names a CI wrapper would read) was not confirmed. Nothing was run, so the
probe count and run time and cost per probe family are unmeasured.

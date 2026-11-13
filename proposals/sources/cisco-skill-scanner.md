# Intake: skill-scanner: cisco-ai-defense/skill-scanner @ f782465 (2.3.2)

Reviewed 2026-11-13 via `/engineering-standard:scout` → `/engineering-standard:consume`. Proposed disposition:
**distilled** (an amendment to AGT-5; the tool is used as a pinned intake scanner). Fetched content was treated as
untrusted data; nothing was installed or run.

**Licence:** Apache-2.0. GitHub reports NOASSERTION because `LICENSE` is the standard short Apache-2.0 notice
(© Cisco Systems) rather than the full text. `scout.mjs` recognised the notice; the ledger records `licenceSource`.

**Scout matrix:** 74/100. Gates G1–G6 pass. C1 3 (unverified org) · C2 5 (52 contributors, release 2026-10-26) ·
C3 4.3 · C4 3 (from the inventory) · C5 4 · C6 3.

**What it is:** a scanner for agent skills. It combines YAML/YARA-X signatures, Python AST and dataflow analysis,
and a CEL decision layer, with an optional LLM judge. It outputs SARIF and ships a reusable GitHub Actions workflow
and a git pre-commit hook.

**Executable surface (`bin/consume.mjs fetch`):** 803 files: 502 executable, and 68 agent-facing files that are the
repo's own Cursor/Windsurf `codeguard` rules (they apply to its contributors, not to users). Its "hooks" are a git
pre-commit integration (`skill_scanner/hooks/pre_commit.py`), not agent hooks. There is no `postinstall`. The real
network destinations (`api.openai.com`, `us.api.inspect.aidefense.security.cisco.com`, `huggingface.co`) occur only
in `evals/` and `scripts/` and in the optional LLM and cloud analyzers. The other hosts are test fixtures. The
README says "every recommended setup runs the LLM judge" and that rules alone catch about 8% of its benchmark (the
vendor's figure, not verified). A local-model mode keeps all data on the machine.

**Gap it fills:** AGT-5 intake today relies on `bin/consume.mjs fetch`, which uses pattern heuristics (hooks,
`!cmd`, symlinks, install scripts, hosts). It has no signature or dataflow scan of bundled scripts and no SARIF
record for later comparison.

**Adopted:** an amendment to AGT-5. Intake also runs a pinned static skill scanner, with the LLM judge off or on a
local model only, and keeps its SARIF output with the intake review.

| Conflict | Source says | Standard says | Resolution |
|---|---|---|---|
| LLM judge egress | recommended setups use `--use-llm` with a cloud provider | AGT-4 / AGT-9: untrusted skill text never goes to a third-party service from an agent session | Static rules or a local model only; never a hosted provider or the Cisco cloud analyzer |
| Install | `pip install cisco-ai-skill-scanner` (latest) | SUP-1 / NPM-1: exact version | `pipx install cisco-ai-skill-scanner==2.3.2`, run outside the agent's sandbox-exempt list |

**Not verified:** detection quality without the LLM judge; whether the PyPI package matches the tagged source
(check for provenance at install); the content of the CEL telemetry (documented as local).

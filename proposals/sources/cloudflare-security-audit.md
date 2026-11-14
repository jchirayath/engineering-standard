# Intake: Cloudflare security-audit skill: cloudflare/security-audit-skill @ c1c8a8c

Reviewed 2026-11-14 via `/engineering-standard:scout` → `/engineering-standard:consume` (unattended run, stopped at
the proposal). Proposed disposition: **distilled** (two amendments: AGT-2 and AGT-13). Fetched content was treated
as untrusted data; nothing was installed or run.

**Licence:** MIT. **Scout matrix:** 77/100 after the fetch (71 before). Gates G1–G6 pass. C1 5 (trusted vendor
`cloudflare`) · C2 2.7 (no push since 2026-09-14, no releases) · C3 5 · C4 5 (from the inventory) · C5 3 · C6 3.

**Provenance:** the repo is in the `cloudflare` GitHub org. G5 flagged 486 stars/day (72.5k stars in about 5 months)
with 3 contributors; G5 doesn't apply to trusted vendors. The README links to Cloudflare's blog post
"Build your own vulnerability harness", and third-party write-ups agree the skill is Cloudflare's. The blog post itself
was not fetched.

**What it is:** an agent-neutral skill for security reviews. In *guidance mode* (the default) it answers security
questions with the relevant parts only. In *full audit mode* (only on an explicit audit request) it runs six phases:
reconnaissance with a deterministic coverage ledger, waves of isolated hunter sub-agents with coverage critics,
fresh-verifier validation of every candidate, `findings.json` checked by two Node validators, independent
re-verification, and a report derived from the records.

**Executable surface (`bin/consume.mjs fetch`):** 22 files, 15 agent-facing (Markdown), 4 executable, no hooks, no
install scripts, no load-time commands, no symlinks, no network hosts in code, nothing unread.
- Executables: `validate-findings.cjs` and `validate-coverage-ledger.cjs` with two `.test.cjs` files, which a test
  runner would pick up only if the repo were cloned and tested.
- Full audit mode writes to `~/security-audit-skill/<repo>/run-N` (outside the target) and starts many parallel
  sub-agents, so it is costly. AGT-7 tool lists apply to them.
- Install as documented is `npx skills add https://github.com/cloudflare/security-audit-skill`, which tracks `main`
  (AGT-5: pin a commit; there are no releases).

**Overlap:** APP_REVIEW already requires a concrete case per finding, `INCOMPLETE` + `unconfirmed` instead of
guesses, adversarial verification with explicit refutation, and a JSON finding schema (adapted from ponytail).
AGT-13 already forbids claims without fresh evidence. AGT-5 (from SkillSpector) records incomplete scans as incomplete.

**Gap it fills:**
1. *Running code under review.* APP_REVIEW tells reviewers to run archetype H/I findings, and AGT-2 sandboxes Bash
   with a network allow-list, but nothing says how to run code you are reviewing. The skill's rule: target code runs
   only in an OS sandbox with **no** external network, an empty allow-listed environment, a read-only target and
   resource limits; never against deployed or shared systems; if the sandbox can't do all that, don't run it and
   mark the finding unconfirmed. → **AGT-2 amendment.**
2. *What counts as a security finding.* A finding names the actor, input, control, crossed boundary and concrete
   result; "checklist deviations presented as vulnerabilities" and "defence-in-depth advice with no reachable
   boundary violation" are its first two anti-patterns. Only confirmed findings get a severity. A scoped or quick run
   "must present itself as partial coverage". → **AGT-13 amendment.**

**Not adopted:** the six-phase orchestration, budget arithmetic and file-descriptor artifact-promotion procedure
(too heavy for the floor; APP_REVIEW §8 already orchestrates reviews); its severity anchors (the standard's §8
P0–P3 scale owns severity); installing the skill as a companion (it would restate rules, against AGT-16).

| Conflict | Source says | Standard says | Resolution |
|---|---|---|---|
| Install | `npx skills add <repo>` tracks `main` | AGT-5: pinned, reviewed commit | not installed; ideas distilled. A repo that wants the skill pins `c1c8a8c` through the gateway |
| Severity scale | critical / high / medium / low / informational | §8 P0–P3 | standard's scale wins; only "no severity without confirmation" is adopted |
| Sub-agent fan-out | many parallel hunters and verifiers | AGT-7 tool lists, cost | unchanged; full audit mode stays an explicit owner request |

**Not verified:** the Cloudflare blog post; the validators' behaviour (not run); 13 of the 15 Markdown companions
were not read in full (SKILL.md and the first part of VALIDATION-AND-REPORTING.md were). Whether APP_REVIEW §8 should
also get the "run only in the sandbox" sentence next to "Archetype H/I findings: run or trace them" is a follow-up
for the owner.

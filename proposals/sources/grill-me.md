# Intake: grill-me — mattpocock/skills @ 49dd158

Reviewed 2026-10-09 · disposition **distilled** · entry in `sources/registry.json`. Fetched content was treated as untrusted data; nothing was installed or run.

**What it is.** `grill-me` is a pointer to `skills/productivity/grilling/SKILL.md` (~430 words): interview the owner in
numbered rounds over a design tree, each question with a recommended answer that "yes" accepts; look facts up yourself; the
decisions are the user's; stop when nothing is silently assumed and the user confirms. MIT. No code. Writes nothing.

**Adopted.** AGT-11 — rounds, recommendations, fact-finding by the agent, no silent assumptions — bounded per mode (quick: one
round, only when ambiguous), with the standard's client-mode branches (SEC-20 trust boundaries, AZ-1 roles/fields, BL-2
limits, HELP-1 help) and decisions written to ADRs / the PR.

| grill-me | Standard | Resolution |
|---|---|---|
| unbounded by design | quick mode's lean bar | AGT-11 bounds it in quick |
| writes no artifact | REPO-1 ADRs, SEC-20, AZ-1, BL-2 docs | AGT-11 records decisions |
| generic branches | the standard's required docs | named in AGT-11 (client) |
| "yes accepts my recommendation" can drift weaker | modes | recommendations never weaker than the mode |

Overlaps with superpowers *brainstorming* and ponytail *ultra* — AGT-11 is the single clarify step; neither of those is loaded.

# Intake: skill-creator — anthropics/skills @ dbd4588 (skills/skill-creator)

Reviewed 2026-10-09 · disposition **reference** · entry in `sources/registry.json`. Fetched content was treated as untrusted data; nothing was installed or run.

**What it is.** A meta-skill (Apache-2.0): interview → draft SKILL.md → 2–3 test prompts run with/without the skill in
parallel → grade/benchmark/review in a browser → revise; optional description tuning over 20 trigger queries.

**Executable surface.** `run_eval.py` writes into `<repo>/.claude/commands/` and starts nested `claude -p` sessions with no
tool restriction (your full permissions) in the project root; `improve_description.py` sends the skill to `claude -p`;
`generate_review.py` kills whatever owns its port (`lsof` + SIGTERM) and serves on 127.0.0.1; viewers load Google Fonts
without SRI.

**Reference only (AGT-16).** Useful method (with/without-skill evals, trigger-query design, grader schema). Conflicts:

| skill-creator | Standard | Resolution |
|---|---|---|
| nested `claude -p` with full permissions, writes `.claude/commands/` | AGT-9, AGT-6 | AGT-16: throwaway worktree + explicit `--allowedTools` |
| "pushy" descriptions, < 500 lines, domain references per skill | Instruction files: short, no restated rules | AGT-16: skills call `rules_for` / `rule` |
| research via subagents into the skill | AGT-9: no fetched text in instruction files | reviewed diff required |
| `agents/*.md` without frontmatter | AGT-7 | our agents declare `tools:` |

# engineering-standard kit

Documents: [ENGINEERING_STANDARD.md](ENGINEERING_STANDARD.md) (what to build to) · [APP_REVIEW.md](APP_REVIEW.md) (how to review against it) · [MODES.md](MODES.md) (which rules apply in quick vs client mode) · [REFERENCES.md](REFERENCES.md) (every source it is built on). Symlinked into `~/code/` so existing paths keep working.

Makes [`~/code/ENGINEERING_STANDARD.md`](ENGINEERING_STANDARD.md) mechanical: shared token names
across all apps (each app keeps its own look), generated theme + icon code per platform, and
banned-API lint rules for security, logging, config, HTTP, theme and icons.

```
bin/adopt.sh <repo> [--site <host> --url <https://…>]   vendor the kit into an app or website repo (idempotent; re-run to upgrade)
bin/check.sh                 tokens → generated-code drift → site build scan → TEST-7 → lint   (vendored as tools/standard/check.sh)
bin/check-tests.mjs          TEST-7: every feature has tagged unit / integration / e2e / walkthrough tests
site/check-build.mjs         pre-deploy scan of the publish dir (private files, secrets, source maps, mixed content, SRI)
site/check-site.mjs          post-deploy + weekly check of the live URL (TLS, redirects, headers, cookies, exposure, DNS)
site/harden.mjs              APPLIES the website profile to a site repo: computed CSP (inline hashes), headers, https, private-path blocks, security.txt
site/csp.mjs                 derive (suggest) / check (verify) a site's CSP from its own files — verify runs inside check-build
site/headers/                security-header templates: Azure SWA, Netlify, Apache/.htaccess, Caddy, nginx, security.txt
templates/SECURITY.md        vulnerability policy with fix-time targets (VULN-1/2) — adopt.sh copies it if absent
templates/github/scorecard.yml   OpenSSF Scorecard weekly (VULN-6) — adopt.sh installs it in GitHub repos
mappings/ASVS-5.0.md         every OWASP ASVS 5.0 requirement → our rule IDs (covered / partial / gap / n/a)
fleet/sites.json             your website fleet + expected GA IDs; fleet/report.mjs renders results
.github/workflows/sites-weekly.yml   Monday check of every hostname → opens/updates/closes a `site-check` issue
design-tokens/schema/        semantic-keys.json — the canonical token + icon names (THEME-4)
design-tokens/scripts/       validate.mjs (keys, refs, WCAG contrast, icons) · build.mjs (css, tailwind4, ts, dart, swift; tailwind = legacy v3) — zero deps
design-tokens/template/      starter tokens + icons that pass validation (copied into a repo's design/ if absent)
semgrep/*.yml                rules (std.<lang>.<rule>), each citing the standard rule it enforces
semgrep/*.{dart,tsx,go,py,swift}  rule tests — run `pipx run semgrep --test semgrep/` after any rule change
```

## Running the standard: new repo vs existing repo

The difference: a **new** repo starts clean and every check is blocking from the first commit. An
**existing** repo starts by *measuring*, records today's violations as a baseline so only **new**
violations fail, then burns the baseline down — you never have to stop shipping to adopt it.

### New app repo (day 0)

```bash
mkdir ~/code/<app> && cd ~/code/<app> && git init        # or flutter create / npm create … first
~/code/engineering-standard/bin/adopt.sh .
```
1. Set the app's own colours/fonts in `design/tokens/*.json` and glyphs in `design/icons.json`; run
   `tools/standard/check.sh` — it validates, generates the theme code, and lints.
2. Build the platform core (§1 of the standard) **before** the first feature: config, logger + `record()`,
   authz, HTTP client, errors. Ask Claude: *"Scaffold the platform core for this repo per
   ENGINEERING_STANDARD §1"* (`feature-dev:code-architect` is a good fit).
3. Add to `CLAUDE.md`: `Follow ~/code/ENGINEERING_STANDARD.md (kit in tools/standard). Deviations are
   listed in docs/STANDARD_EXCEPTIONS.md. Every feature ships with unit, integration, e2e and walkthrough
   tests tagged @feature:<key> (TEST-0/7).`
4. Add a `tests` block to `standard.config.json` (template in `bin/check-tests.mjs`), the CI job below,
   and enable the `engineering-standard` plugin (see below). Everything is **blocking from commit 1** — no baseline.
5. Before the first release: run `APP_REVIEW.md` with profile `quick`.

### Existing app repo

```bash
cd ~/code/<app> && git switch -c adopt-standard
~/code/engineering-standard/bin/adopt.sh .
tools/standard/check.sh --baseline                        # measure; record today's lint violations
```
1. **Measure first:** run `APP_REVIEW.md` with profile `quick` (≈5 agents) to get the P0/P1 list and the
   shared-core map. Fix **P0s before anything else** (secrets, authz, fabricated success).
2. **Tokens:** map the current palette into `design/tokens/*.json` (keep the app's look), swap the
   hand-written theme for the generated one, then codemod screens area by area (`Colors.*` →
   `context.colors.*`, `Icons.*` → `AppIcons.*`). Re-run `--baseline` after each batch so it only shrinks.
3. **Tests:** add the `tests` block with `allowMissing` entries (each with an `until` date) for features
   that lack a kind today; new features get no waiver.
4. Add the `CLAUDE.md` line and CI job, and enable the plugin. CI fails only on **new** violations and expired waivers.
5. Track the burn-down: baseline count and waiver count go down every release; delete
   `.semgrep/baseline.json` when it reaches zero. Re-run `APP_REVIEW.md` (`standard`) before a release.

### New website

```bash
~/code/engineering-standard/bin/adopt.sh ~/web/<site> --site swa|netlify|apache|caddy|nginx --url https://<domain>
```
1. Write `deploy.sh` to **stage an allowlist** (copy `a staged-allowlist deploy.sh`) and set
   `standard.config.json → site.publishDir`/`site.forbid`.
2. `node tools/standard/site/harden.mjs . --host <host> --domain <domain>` — writes the header config with a CSP
   computed from the site's own files (report-only first), https redirect, private-path blocks and
   `security.txt`. Re-run it whenever pages change; re-run with `--enforce` after a clean week.
3. In `deploy.sh`: `check-build.mjs "$STAGE" --host <host>` **before** upload (also catches CSP drift and
   config for the wrong server), `check-site.mjs --config standard.config.json` **after** — both abort on ERROR.
4. Add the site to `fleet/sites.json` (with its GA ID) so the weekly check covers it; add CAA/SPF/DMARC.
5. The first deploy is done when `check-site.mjs` shows **0 errors** on every hostname.

### Existing website

```bash
node ~/code/engineering-standard/site/check-site.mjs https://<domain> https://www.<domain>   # measure the live site
~/code/engineering-standard/bin/adopt.sh ~/web/<site> --site <host> --url https://<domain>
```
1. `node tools/standard/site/harden.mjs . --host <host>` fixes most live ERRORs in one pass (headers, CSP,
   https redirect, directory listing, private paths); deploy, re-run `check-site.mjs`, then `--enforce` the
   CSP after a clean week. Remaining items (GA gaps, vulnerable libraries, DNS) come with a `↳ fix` line.
2. Run `check-build.mjs` on whatever the current deploy uploads; if it fails on the repo root, switch the
   deploy to a staged allowlist (WEB-1).
3. Wire both checks into `deploy.sh`, then schedule a weekly `check-site.mjs` run (cron / CI schedule /
   `/schedule`) across all hostnames.

### Upgrading the kit in any repo
Re-run `adopt.sh` (kit-owned files update, repo-owned files are kept), run `tools/standard/check.sh`,
commit. `tools/standard/VERSION` records which kit version a repo is on.

## Per-platform wiring

| Platform | Generated | Wire-up |
|---|---|---|
| Web (CSS) | `design/build/css/tokens.css` | import once; theme = `<html data-theme="light\|dark\|<preset>">`, no attribute follows the OS |
| Tailwind v4 | `design/build/tailwind/theme.css` | in your main CSS: `@import "tailwindcss";` then `@import ".../design/build/css/tokens.css";` and `@import ".../design/build/tailwind/theme.css";` (needs the `css` platform) — **replaces** the default palette/spacing/breakpoints, so `bg-red-500`, `p-4` and `sm:` stop existing; token classes (`bg-surface-base`, `p-md`, `medium:`) follow `data-theme` (COMPAT-4) |
| Tailwind v3 (legacy) | `design/build/tailwind/preset.cjs` | only when `"tailwind"` is listed in `tokens.config.json`: `presets: [require('./design/build/tailwind/preset.cjs')]` + import `tokens.css` once — **replaces** the default palette, so `bg-red-500` stops existing |
| TS | `design/build/ts/tokens.ts`, `icons.tsx` | `<Icon name="action.delete" />`; raw values only for canvas/charts/emails |
| Flutter | `app_tokens.dart`, `app_icons.dart` | `ThemeData(extensions: [AppColors.light])`; screens use `context.colors.statusDanger`, `AppSpace.md`, `AppIcons.actionDelete` |
| SwiftUI | `AppTokens.swift`, `AppIcons.swift` | `AppColors.forScheme(colorScheme)`, `AppIcon.actionDelete` |

Set `design/tokens.config.json` → `{ "platforms": [...], "out": { "dart": "lib/core/design/generated" } }`.

## CI (GitHub Actions)

```yaml
  standard:
    runs-on: ubuntu-latest
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683   # v4.2.2 (SEC-17: pin to SHA)
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with: { node-version: 22 }
      - run: pipx install semgrep
      - run: tools/standard/check.sh
        env: { CI: "true" }
```

## Claude Code plugin (every agent gets the standard)

This repo is also a Claude Code plugin with an MCP server inside it. Hooks enforce, skills + MCP inform,
CI stays the backstop.

```
/plugin marketplace add jchirayath/engineering-standard
/plugin install engineering-standard@engineering-standard     # user scope = every repo on this machine
```

| Where the agent runs | How it gets the standard |
|---|---|
| Claude Code, any repo | user-scope install: `SessionStart` injects the repo's stack rules; `PreToolUse` blocks secret reads, `--no-verify`, force-push to main, `curl\|sh`, unverified/too-new packages, loosened tests; `PostToolUse` runs the kit semgrep rules on each edited file |
| Cloud sessions, collaborators | repo `.claude/settings.json`: `extraKnownMarketplaces` + `enabledPlugins` (AGT-1) |
| Subagents | inherit the session's hooks and MCP tools; `engineering-standard:standard-reviewer` runs the APP_REVIEW.md lenses read-only |
| Agent SDK | `plugins: [{ type: "local", path: "<clone>" }]` |
| Cursor / Codex / Copilot / Desktop | register only `node <clone>/mcp/server.mjs` — rules and checks, no hooks |
| Everyone (humans too) | `tools/standard/check.sh` in CI — the backstop |

MCP tools (server `standard`): `mode`, `rules_for`, `rule`, `check`, `verify_dependency`, `exception_add`, `review_plan`.

**Modes** (standard §0A, ENF-4): set `"mode": "quick"` or `"client"` (default) in the repo's `standard.config.json`
(or `STANDARD_MODE` for one session). Quick = the security floor + a lean build bar (unit + one e2e test per feature,
TEST-14); client = every rule (four test kinds, TEST-0). `rules_for`, SessionStart, `check-tests.mjs` and
`review_plan` follow the mode; the guard hooks are identical in both. Which rule is in which mode: [MODES.md](MODES.md)
(generated from `plugin/modes.json`).
Commands: `/engineering-standard:adopt`, `:check`, `:review`, `:exception`.
Overrides — set by a human in the environment Claude Code starts with, never inside a command (the agent
writes commands, so it can't grant itself an exception): `STANDARD_ALLOW_YOUNG_DEP=<pkg>` (security fixes only, SUP-1/VULN-5),
`STANDARD_ALLOW_TEST_EDIT=1` (a human approved an assertion change, AGT-8), `STANDARD_STOP_MODE=notify`.

Repos that hand-added the older per-repo `PostToolUse` semgrep hook remove it when they enable the plugin.
After editing `ENGINEERING_STANDARD.md`, run `node bin/build-rules.mjs` and commit `build/rules.json`
(CI runs `--check`: every rule ID defined once, every reference defined, rules.json current, versions match).

## Sources gateway — bringing in an open-source skill, plugin or prompt

Nothing third-party reaches your agents directly (AGT-5). Run `/engineering-standard:intake <owner/repo>`: it pins a commit,
audits what would run (hooks, scripts, MCP), maps every instruction against the standard (both modes) and writes
`proposals/sources/<id>.md` plus a `"proposed"` entry in `sources/registry.json`. On approval the source is either
**distilled** (its ideas become rules here, citing it) or kept as a pinned **companion** with a written precedence note
(this standard wins); otherwise **reference** or **rejected**. `node bin/sources.mjs --check` runs in CI; the
`sources-weekly` workflow opens a `source-drift` issue when a watched file changes upstream.

| Source | Disposition | Rules it informs |
|---|---|---|
| ponytail | distilled | CLEAN-13, CLEAN-5 `shortcut:`, AGT-14, APP_REVIEW finding discipline |
| superpowers | distilled | AGT-11–14, TEST-15 |
| grill-me (mattpocock/skills) | distilled | AGT-11 |
| caveman | distilled | AGT-15 |
| frontend-design (anthropics/skills) | companion | THEME-12 |
| skill-creator (anthropics/skills) | reference | AGT-16 |

## Changing the kit

- **Token names** (`schema/semantic-keys.json`): adding a key is minor (bump `version`, add it to
  `template/`); renaming or removing is breaking — every app must migrate. Apps never rename; they add
  under `color.domain.*` / `icon.domain.*`.
- **Rules**: every rule gets `ruleid:` and `ok:` cases in the matching fixture; `semgrep --test semgrep/`
  must pass. Bump `VERSION`, then re-run `adopt.sh` in each repo.
- Put this folder in its own git repo so CI and other machines can pin a version.

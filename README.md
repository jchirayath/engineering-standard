# engineering-standard kit

Documents: [ENGINEERING_STANDARD.md](ENGINEERING_STANDARD.md) (what to build to) · [APP_REVIEW.md](APP_REVIEW.md) (how to review against it). Symlinked into `~/code/` so existing paths keep working.

Makes [`~/code/ENGINEERING_STANDARD.md`](ENGINEERING_STANDARD.md) mechanical: shared token names
across all apps (each app keeps its own look), generated theme + icon code per platform, and
banned-API lint rules for security, logging, config, HTTP, theme and icons.

```
bin/adopt.sh <repo> [--site <host> --url <https://…>]   vendor the kit into an app or website repo (idempotent; re-run to upgrade)
bin/check.sh                 tokens → generated-code drift → site build scan → TEST-7 → lint   (vendored as tools/standard/check.sh)
bin/check-tests.mjs          TEST-7: every feature has tagged unit / integration / e2e / walkthrough tests
site/check-build.mjs         pre-deploy scan of the publish dir (private files, secrets, source maps, mixed content, SRI)
site/check-site.mjs          post-deploy + weekly check of the live URL (TLS, redirects, headers, cookies, exposure, DNS)
site/headers/                security-header templates: Azure SWA, Netlify, Apache/.htaccess, Caddy, nginx, security.txt
design-tokens/schema/        semantic-keys.json — the canonical token + icon names (THEME-4)
design-tokens/scripts/       validate.mjs (keys, refs, WCAG contrast, icons) · build.mjs (css, tailwind, ts, dart, swift) — zero deps
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
3. Add to `CLAUDE.md`: `Follow ~/code/ENGINEERING_STANDARD.md (kit in tools/standard). Every feature ships
   with unit, integration, e2e and walkthrough tests tagged @feature:<key> (TEST-0/7).`
4. Add a `tests` block to `standard.config.json` (template in `bin/check-tests.mjs`), the CI job below,
   and the Claude Code hook. Everything is **blocking from commit 1** — no baseline.
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
4. Add the `CLAUDE.md` line, CI job and hook. CI fails only on **new** violations and expired waivers.
5. Track the burn-down: baseline count and waiver count go down every release; delete
   `.semgrep/baseline.json` when it reaches zero. Re-run `APP_REVIEW.md` (`standard`) before a release.

### New website

```bash
~/code/engineering-standard/bin/adopt.sh ~/web/<site> --site swa|netlify|apache|caddy|nginx --url https://<domain>
```
1. Write `deploy.sh` to **stage an allowlist** (copy `a staged-allowlist deploy.sh`), set
   `standard.config.json → site.publishDir`/`site.forbid`, and put the generated header config
   (`staticwebapp.config.json`, `netlify.toml`, `.htaccess`, or the Caddy/nginx snippet) in the shipped files.
2. In `deploy.sh`: `check-build.mjs "$STAGE"` **before** upload, `check-site.mjs --config standard.config.json`
   **after** — both abort on ERROR.
3. Fill in `.well-known/security.txt`, add CAA/SPF/DMARC records, add the URL to Uptime Kuma.
4. The first deploy is done when `check-site.mjs` shows **0 errors** on every hostname.

### Existing website

```bash
node ~/code/engineering-standard/site/check-site.mjs https://<domain> https://www.<domain>   # measure the live site
~/code/engineering-standard/bin/adopt.sh ~/web/<site> --site <host> --url https://<domain>
```
1. Fix live ERRORs in this order: exposed files / directory listing → https redirect + HSTS → CSP +
   clickjacking → nosniff. Ship the header template; roll CSP out as `Content-Security-Policy-Report-Only`
   for one deploy if the site has third-party embeds, then enforce.
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
| Tailwind v3 | `design/build/tailwind/preset.cjs` | `presets: [require('./design/build/tailwind/preset.cjs')]` — **replaces** the default palette, so `bg-red-500` stops existing |
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

## Claude Code hook (instant feedback while editing)

Add via `/update-config` (project `.claude/settings.json`):

```json
{ "hooks": { "PostToolUse": [ { "matcher": "Edit|Write",
  "hooks": [ { "type": "command",
    "command": "f=$(jq -r '.tool_input.file_path'); semgrep --metrics=off --config .semgrep/standard -q --error \"$f\" >&2 || exit 2" } ] } ] } }
```

Exit code 2 feeds the violation back to Claude, which fixes it in the same turn.

## Changing the kit

- **Token names** (`schema/semantic-keys.json`): adding a key is minor (bump `version`, add it to
  `template/`); renaming or removing is breaking — every app must migrate. Apps never rename; they add
  under `color.domain.*` / `icon.domain.*`.
- **Rules**: every rule gets `ruleid:` and `ok:` cases in the matching fixture; `semgrep --test semgrep/`
  must pass. Bump `VERSION`, then re-run `adopt.sh` in each repo.
- Put this folder in its own git repo so CI and other machines can pin a version.

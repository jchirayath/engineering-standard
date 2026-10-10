# References — what the engineering standard is built on

Every external source that [`ENGINEERING_STANDARD.md`](ENGINEERING_STANDARD.md), [`APP_REVIEW.md`](APP_REVIEW.md) and the kit draw
on, with the rules each one informs. **Rule IDs are the link:** look a rule up with the MCP `rule` tool (or in the standard)
to see exactly how a source was applied. Where this standard and a source disagree, the standard wins and says why.

As of **v1.3.0 (2026-10-09)**. Dated facts (store deadlines, law effective dates, version floors) are a snapshot; the CI
checks named in the rules (STORE-1/2, LIFE-1, NEXT-4, AI-2 …) are what keep them current, not this page.

**Confidence** (from the v1.3 research, [`proposals/v1.3-gap-report.md`](proposals/v1.3-gap-report.md)): ✅ primary source read ·
◐ secondary source only — adopted as policy without the unverified specifics · sources the research could **not** confirm are
listed under [Held back](#held-back--not-yet-a-source-of-any-rule), not used.

---

## How it was built

| Version | Date | What came in | Primary basis |
|---|---|---|---|
| 1.0.0 | 2026-10-04 | The standard, review harness (`APP_REVIEW.md`), lint/token kit | Consolidated the owner's `SecureApplication.md` (controls) and `QA_PLAYBOOK.md` (build-time rules) |
| 1.1.0 | 2026-10-05 | Website build & deploy profile (§2A), live vulnerability + analytics checks, clean-code rules | OWASP Top 10, security-header guidance, OSV |
| 1.2.0 | 2026-10-05 | §2B — OWASP ASVS 5.0 Levels 1–2 closed, OTel log schema, API, mobile, reliability, vulnerability rules, Scorecard | OWASP ASVS 5.0 (full matrix in [`mappings/ASVS-5.0.md`](mappings/ASVS-5.0.md)), OpenTelemetry, RFC 9457, OWASP API Top 10, MASVS |
| 1.3.0 | 2026-10-09 | AI-agent rules (§2C), LLM controls (§2D), supply chain & lifecycle (§2E), privacy & regulation (§2F), compatibility (§3B), stores & Flutter (§6J), Next.js/Supabase/Firebase/Azure (§6K), quick/client modes (§0A), sources gateway | Four parallel research passes with a primary source per claim ([gap report](proposals/v1.3-gap-report.md)); six reviewed open-source agent projects ([below](#agent-workflow-sources-reviewed-pinned)); two independent conflict audits + five security-review rounds of the plugin |

---

## Security verification & threat frameworks

| Source | Informs |
|---|---|
| [**OWASP ASVS 5.0**](https://owasp.org/www-project-application-security-verification-standard/), Levels 1–2 | §2B (INP, BL, BRW, FILE, AUTH, SESS, AZ, TOK, CRY, TLS, CFG, DATA, SLOG); requirement-by-requirement map in `mappings/ASVS-5.0.md` |
| [**OWASP Top 10**](https://owasp.org/www-project-top-ten/) (web) | §2 SEC-1…32, §2A, APP_REVIEW §9.1 |
| [**OWASP API Security Top 10**](https://owasp.org/API-Security/) | API-12, API-4, PERF-3, SEC-5/6/7 |
| [**OWASP Top 10 for LLM Applications**](https://genai.owasp.org/llm-top-10/) (LLM01, LLM07–LLM10) | SEC-19, AI-1…9 |
| [**OWASP Top 10 for Agentic Applications**](https://genai.owasp.org/) (2026) ◐ item names | SEC-19, AGT-4, AGT-9 (memory poisoning) |
| [**OWASP Password Storage**](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) parameters (Argon2id m ≥ 19 MiB, t ≥ 2; bcrypt cost ≥ 10) | SEC-22, CRY-3 |
| [**OWASP MASVS**](https://mas.owasp.org/MASVS/) / [**MASTG**](https://mas.owasp.org/MASTG/) (incl. MASVS-RESILIENCE, MASTG BEST-0036/37) | §6C MOB-1…12 (MOB-9, MOB-10) |
| [**NIST SP 800-63-4 / 800-63B-4**](https://pages.nist.gov/800-63-4/) (digital identity, final 2025) ✅ | AUTH-2 (15-char minimum without enforced MFA), AUTH-4, SESS-1 |
| [**NIST SP 800-57**](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final) (key management) | CRY-1 |
| [**Mozilla Server Side TLS**](https://wiki.mozilla.org/Security/Server_Side_TLS) — "intermediate" profile | TLS-1 |
| [**CISA Known Exploited Vulnerabilities (KEV)**](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) | VULN-2, §8 severity |
| [**CISA Secure by Design pledge**](https://www.cisa.gov/securebydesign/pledge) | SBD-1 |
| [**"The lethal trifecta"**](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) — Simon Willison, 2025-06 ✅ | AGT-4 |
| [**Model Context Protocol specification 2025-11-25**](https://modelcontextprotocol.io/specification/2025-11-25) — [authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) ✅ | AI-7 |
| [**OpenSSF Security-Focused Guide for AI Code Assistant Instructions**](https://best.openssf.org/Security-Focused-Guide-for-AI-Code-Assistant-Instructions) (2025) ✅ | §2C "Instruction files", AGT-16 |
| [**OpenSSF Scorecard**](https://github.com/ossf/scorecard) | VULN-6, `templates/github/scorecard.yml` |
| [**OpenSSF OSPS Baseline**](https://baseline.openssf.org/) | SUP-7 |
| [**SLSA**](https://slsa.dev/) (Build L2+) | SEC-32, SUP-7 |
| STRIDE (threat modelling) | SEC-20 |

## Protocols, formats & web platform

| Source | Informs |
|---|---|
| [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details for HTTP APIs | API-5, CORE-7, CORE-12 |
| [RFC 3339](https://www.rfc-editor.org/rfc/rfc3339) timestamps | LOG-1, API-6 |
| [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986) URI syntax | UX-6 (`mailto:` encoding) |
| [RFC 6266](https://www.rfc-editor.org/rfc/rfc6266) / [RFC 5987](https://www.rfc-editor.org/rfc/rfc5987) (Content-Disposition, filename encoding) | FILE-2 |
| [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238) TOTP | AUTH-5, CRY-3 |
| [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) OAuth Protected Resource Metadata · [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707) Resource Indicators · [OAuth 2.1](https://oauth.net/2.1/) + PKCE (S256) | AI-7, SEC-25, TOK-1…3 |
| [OpenID Connect](https://openid.net/developers/specs/) (`iss`/`sub`, `acr`/`amr`, back-channel logout) | AUTH-6, TOK-2/3, SESS-5 |
| `security.txt` ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)) | WEB-9, VULN-1 |
| JSON Merge Patch ([RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)) · `ETag`/`If-Match` | API-9 |
| `Deprecation` / `Sunset` headers | API-11 |
| [**OpenTelemetry** log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) + [semantic conventions](https://opentelemetry.io/docs/specs/semconv/); [**W3C Trace Context**](https://www.w3.org/TR/trace-context/) | LOG-1…10, AGT-10 |
| [**Design Tokens Community Group (DTCG)**](https://www.designtokens.org/) format | THEME-1…12, kit `design-tokens/` |
| [WebAuthn](https://www.w3.org/TR/webauthn-3/) / [passkeys](https://passkeys.dev/) (conditional UI) | AUTH-4, WEB-22 |
| CSP (nonces/hashes, `strict-dynamic`), HSTS, [Trusted Types](https://www.w3.org/TR/trusted-types/), [Fetch Metadata](https://www.w3.org/TR/fetch-metadata/) (`Sec-Fetch-Site`), COOP/CORP/COEP, Subresource Integrity, `Clear-Site-Data` | SEC-14, BRW-1…5, WEB-3, WEB-6, WEB-18…21, SESS-3 |
| [Global Privacy Control](https://globalprivacycontrol.org/) (`Sec-GPC`) | PRIV-1 |
| [Core Web Vitals](https://web.dev/articles/vitals) (LCP, INP, CLS) · Long Animation Frames · [bfcache](https://web.dev/articles/bfcache) · [Speculation Rules](https://developer.chrome.com/docs/web-platform/prerender-pages) · `content-visibility` | PERF-1, PERF-18, PERF-22…25 |
| [Baseline](https://web.dev/baseline) ("widely available") · browserslist | COMPAT-1 |
| `PopScope` / predictive back, Android edge-to-edge (Android 16) | STORE-3 |

## Accessibility

| Source | Informs |
|---|---|
| [**WCAG 2.2 AA**](https://www.w3.org/TR/WCAG22/) | UX-5, THEME-7 (contrast at build), TEST-13 |
| **EN 301 549** · [**European Accessibility Act**](https://eur-lex.europa.eu/eli/dir/2019/882/oj) ◐ (app as product vs service) | REG-3 |
| axe-core / Flutter `meetsGuideline` | TEST-13 |

## Law & regulation

| Source | Informs |
|---|---|
| [**EU Cyber Resilience Act**](https://eur-lex.europa.eu/eli/reg/2024/2847/oj) — Regulation (EU) 2024/2847, Art. 14 reporting from 2026-09-11 ✅ (◐ scope for unmonetised solo OSS) | REG-1 |
| [**EU AI Act**](https://eur-lex.europa.eu/eli/reg/2024/1689/oj) — Regulation (EU) 2024/1689, Art. 50 transparency from 2026-08-02 ✅ | AI-8 |
| [**GDPR**](https://eur-lex.europa.eu/eli/reg/2016/679/oj) — Regulation (EU) 2016/679: Art. 30 records, DPAs, transfers (EU–US Data Privacy Framework / SCCs; appeal C-703/25 P pending), DPIA | REG-2, SEC-13, DATA-1, PRIV-3 |
| [**California CCPA regulations**](https://cppa.ca.gov/regulations/) — opt-out preference signals (2026-01-01) ✅ (◐ list of other states) | PRIV-1 |
| **Texas SB 2420** (app-store age assurance) ✅ | STORE-6 |

## App store & platform vendor policies

| Source | Informs |
|---|---|
| [**Apple App Review Guidelines**](https://developer.apple.com/app-store/review/guidelines/) 5.1.1(v) account deletion · 4.8 login services · 5.1.2(i) data to third-party AI ✅ | STORE-4, STORE-5, AI-9 |
| Apple: builds with **Xcode 26 / iOS 26 SDK** (from 2026-04-28) ✅; privacy manifest & required-reason APIs; Declared Age Range | STORE-1, MOB-8, STORE-6 |
| **Google Play**: [target API](https://developer.android.com/google/play/requirements/target-sdk) **36** for updates (from 2026-08-31) ✅; [**16 KB page size**](https://developer.android.com/guide/practices/page-sizes) (from 2027-02-01) ✅; account-deletion URL; Data safety form; [Android vitals](https://developer.android.com/topic/performance/vitals) bad-behaviour thresholds (crash 1.09 %, ANR 0.47 %) ✅; photo-picker / foreground-service / exact-alarm policies; Play Age Signals; Play Integrity | STORE-1…8, MOB-5, MOB-8, PRIV-2 |
| **Claude Code documentation** — [permissions](https://code.claude.com/docs/en/permissions), [sandboxing](https://code.claude.com/docs/en/sandboxing), [hooks](https://code.claude.com/docs/en/hooks), [plugins & marketplaces](https://code.claude.com/docs/en/plugins), [settings](https://code.claude.com/docs/en/settings), headless mode ✅ | AGT-1…7, the plugin itself |
| **Next.js** — [data-security guide](https://nextjs.org/docs/app/guides/data-security); [CVE-2025-29927](https://nvd.nist.gov/vuln/detail/CVE-2025-29927) (middleware auth bypass) ✅; [CVE-2025-55182](https://nvd.nist.gov/vuln/detail/CVE-2025-55182) (React Server Components) ✅; Next 16 conventions (`proxy.ts`, async request APIs) | NEXT-1…6, COMPAT-5 |
| **Supabase** — [publishable/secret API keys](https://supabase.com/docs/guides/api/api-keys) and legacy-key retirement ✅; [database advisors](https://supabase.com/docs/guides/database/database-advisors) ✅; [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) performance guidance ✅; leaked-password protection | SUPA-1…4, SEC-8 |
| **Firebase** — [App Check](https://firebase.google.com/docs/app-check) (App Attest / Play Integrity), Analytics consent mode, FCM HTTP v1 | FB-1, FB-2 |
| **Flutter / Dart** — `--dart-define` values are compiled in; [Swift Package Manager](https://docs.flutter.dev/packages-and-plugins/swift-package-manager/for-app-developers) (CocoaPods trunk read-only 2026-12-02) ✅ | FLT-1…4 |
| **Microsoft Azure** — [Key Vault RBAC](https://learn.microsoft.com/azure/key-vault/general/rbac-guide) + purge protection ◐; Azure Files soft delete & backup ✅; [Static Web Apps PR environments](https://learn.microsoft.com/azure/static-web-apps/review-publish-pull-requests) are public ✅; Defender for Cloud Foundational CSPM ✅ | AZR-1…3, WEB-17 |
| **Vercel** — [Deployment Protection](https://vercel.com/docs/deployment-protection) | WEB-17 |
| [**Tailwind CSS v4**](https://tailwindcss.com/docs/theme) (CSS-first `@theme`, Safari 16.4 floor) ✅ | COMPAT-1, COMPAT-4, THEME-1; kit `tailwind4` output (compiled with the v4.3.3 CLI) |
| [**Node.js release schedule**](https://nodejs.org/en/about/previous-releases) (Node 24 maintenance 2026-10-20, Node 26 LTS 2026-10-28) ✅ · **TypeScript 6** ✅ (◐ 7.0 date) · **ESLint flat config** | COMPAT-2, COMPAT-3, COMPAT-6 |

## Supply chain & lifecycle

| Source | Informs |
|---|---|
| [**pnpm 11**](https://pnpm.io/settings) `minimumReleaseAge`, build allow-list ✅ · [Dependabot `cooldown`](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference) ✅ · Renovate `minimumReleaseAge` ✅ | NPM-1, SUP-1, the plugin's install hook |
| [**npm trusted publishing**](https://docs.npmjs.com/trusted-publishers) (OIDC) + provenance, `npm audit signatures` ✅ | SUP-2 |
| [**GitHub immutable releases**](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases), [artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds) (`gh attestation verify`) ✅ | SUP-3, SUP-4, SEC-32 |
| [**Docker Hardened Images**](https://docs.docker.com/dhi/) (Apache-2.0), distroless, Chainguard ✅ | SUP-5, SEC-16 |
| `uv.lock` / `--require-hashes` (✅) · [PEP 751](https://peps.python.org/pep-0751/) `pylock.toml` (◐ pip support) | SUP-6 |
| [**endoflife.date**](https://endoflife.date/) | LIFE-1, WEB-16 |
| [**OSV**](https://osv.dev/) | SEC-15, WEB-16, VULN-3, the plugin's `verify_dependency` |
| [HIBP Pwned Passwords](https://haveibeenpwned.com/API/v3) (k-anonymity) | AUTH-2 |
| Slopsquatting / typosquatting research | SEC-31, the plugin's typosquat hint |

## Engineering practice

| Source | Informs |
|---|---|
| [**The Twelve-Factor App**](https://12factor.net/) | OPS-8, CORE-1 |
| [**Google SRE**](https://sre.google/books/) — SLOs, error budgets, burn-rate alerting, blameless postmortems | REL-1…5, LOG-3, LOG-9 |
| [**DORA**](https://dora.dev/) metrics | OPS-9 |
| Test pyramid · property-based testing · mutation testing · fuzzing | TEST-1, TEST-10…12 |
| [Architecture Decision Records](https://adr.github.io/) | REPO-1, CLEAN-8, AGT-11/12 |
| [Conventional Commits](https://www.conventionalcommits.org/) | REPO-3 |

## Tools the kit and rules rely on

[Semgrep](https://semgrep.dev/) (kit rules + `p/default`, `p/owasp-top-ten`) · [gitleaks](https://github.com/gitleaks/gitleaks) · [osv-scanner](https://github.com/google/osv-scanner) · govulncheck · npm audit · pip-audit · [trivy](https://github.com/aquasecurity/trivy)
(fs/config/image) · checkov · [zizmor](https://github.com/zizmorcore/zizmor) · [syft](https://github.com/anchore/syft) · OpenSSF Scorecard action · Lighthouse CI · `@axe-core/playwright` · size-limit ·
knip / deadcode / vulture · dependency-cruiser / import-linter / depguard · ESLint (+ security, compat) · ruff · mypy/pyright ·
golangci-lint · swiftlint · `very_good_analysis` · Playwright · Flutter `integration_test` · k6 · Stryker / mutmut ·
fast-check / hypothesis · `aapt2`, `zipalign`, `supabase db advisors`, `gh`. Each is named in the rule it enforces (§7.1).

## Claude Code plugins & skills the standard uses

The standard's own plugin (this repository) is the always-on layer. §7.4 names the other Claude Code plugins and
built-in commands agents use at specific moments; the plugins come from Anthropic's
[official plugin marketplace](https://github.com/anthropics/claude-plugins-official) and the skills from
[anthropics/skills](https://github.com/anthropics/skills). Docs: [Claude Code plugins](https://code.claude.com/docs/en/plugins).

| When | Plugin / skill / command | Informs |
|---|---|---|
| Every session, every repo | **engineering-standard** (this repo): hooks, stack skills, MCP tools, `standard-reviewer` | the whole standard (§7.3) |
| Before writing a feature | `feature-dev` (explorer → architect → reviewer) | §1 CORE, AGT-11/12 |
| Before opening a PR | `/security-review` · `/code-review` · `/simplify` | §2, CLEAN-*, AGT-13 |
| Large branch / pre-release | `/code-review ultra` (cloud multi-agent review) | APP_REVIEW |
| Supabase / Postgres | `supabase` — Postgres best practices (RLS, indexes, SECURITY DEFINER) | SEC-8, SUPA-* |
| Azure apps | `azure` — App Insights instrumentation, compliance | LOG-*, AZR-* |
| Vercel apps | `vercel` — verification, firewall | WEB-17 |
| Keeping repos aligned | `claude-md-management` — `claude-md-improver` | §2C instruction files |
| Live verification | `playwright` (browser automation) | TEST-4/6, APP_REVIEW §8.4 |
| Web UI design | `frontend-design` — pinned companion | THEME-12 |
| Authoring skills | `skill-creator` — reference only | AGT-16 |
| Building plugins | `plugin-dev` (structure, hooks, MCP, validation) — used to build this plugin | AGT-7, AGT-16 |

## Agent-workflow sources (reviewed, pinned)

Third-party agent projects reach this standard only through the sources gateway (AGT-5): pinned in
[`sources/registry.json`](sources/registry.json), reviewed in [`proposals/sources/`](proposals/sources/), re-reviewed when the weekly
`sources-weekly` job sees a watched file change upstream.

<!-- sources-references:begin — generated by `node bin/sources.mjs --render` from sources/registry.json; do not edit -->
| Source | Pinned commit | License | Disposition | Informs |
|---|---|---|---|---|
| [ponytail](https://github.com/DietrichGebert/ponytail) — DietrichGebert | `9cc65d0` (v5.1.0) | MIT | distilled | CLEAN-13, CLEAN-5, AGT-14 · CLEAN-5 `shortcut:` comments, APP_REVIEW finding discipline |
| [superpowers](https://github.com/obra/superpowers) — Jesse Vincent | `8ca22db` (v6.4.2) | MIT | distilled | AGT-11, AGT-12, AGT-13, AGT-14, TEST-15 |
| [grill-me / grilling](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling) — Matt Pocock | `49dd158` | MIT | distilled | AGT-11 |
| [caveman](https://github.com/JuliusBrussee/caveman) — Julius Brussee | `e20f07e` (v3.2.0) | Apache-2.0 (from 3.0.0; 'Caveman' is a trademark) | distilled | AGT-15, AGT-13 |
| [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) — Anthropic | `dbd4588` | Apache-2.0 | companion | THEME-12, UX-1 |
| [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) — Anthropic | `dbd4588` | Apache-2.0 | reference | AGT-16 |
| [docker-destructive-guardrails](https://github.com/docker/skills/tree/main/skills/docker-destructive-guardrails) — Docker | `f791727` | Apache-2.0 | distilled | AGT-17 |
| [Playwright test agents](https://github.com/microsoft/playwright/tree/main/packages/playwright/src/agents) — Microsoft | `d9f2fd3` | Apache-2.0 | distilled | AGT-8 |
| [code-modernization](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-modernization) — Anthropic | `b8e53f1` | Apache-2.0 | distilled | TEST-15 |
| [Trail of Bits skills (agentic-actions-auditor)](https://github.com/trailofbits/skills) — Trail of Bits | `442fc9d` | CC-BY-SA-4.0 | distilled | AGT-6 |
| [Sentry skills (gha-security-review, skill-scanner, iterate-pr)](https://github.com/getsentry/skills) — Sentry | `d18b7aa` | Apache-2.0 | distilled | AGT-6, AGT-5, AGT-4, AGT-9 |
| [ECC database-migrations](https://github.com/affaan-m/ECC/tree/main/skills/database-migrations) — affaan-m | `8384d60` | MIT | distilled | COR-7 |
| [Supabase agent skill](https://github.com/supabase/agent-skills/tree/main/skills/supabase) — Supabase | `c9be0e9` | MIT | distilled | SUPA-5 |
| [firebase-security-rules-auditor](https://github.com/firebase/agent-skills/tree/main/skills/firebase-security-rules-auditor) — Google (Firebase) | `b5735e5` | Apache-2.0 | distilled | FB-3 |
| [Vercel React best practices](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) — Vercel | `063bee9` | MIT (per skill frontmatter; repo licence not declared) | distilled | NEXT-7 |
<!-- sources-references:end -->

### Why each source was handled this way

Where several sources covered the same ground, one was chosen and the others recorded as supporting or rejected —
the standard keeps one rule per fact.

<!-- sources-rationale:begin — generated by `node bin/sources.mjs --render` from sources/registry.json; do not edit -->
- **ponytail** (distilled) — Distilled, not installed. Its 'least code' order is the clearest statement of the idea, so it is CLEAN-13's source (superpowers and caveman reach the same goal only indirectly). Not installed because its hooks inject a persona into every session and subagent (breaking the JSON-only reviewer), write under ~/.claude, and its test/help floor is weaker than TEST-14/TEST-0.
- **superpowers** (distilled) — Distilled, not installed. The most complete plan → failing test → verify → root-cause-debug workflow, so it is the source for AGT-12…14 and TEST-15 — no other source covered those as fully. Its brainstorming step lost to grill-me (see there). Not installed: its SessionStart hook forces skill-first behaviour, its subagents have no tool allow-lists (AGT-7), and it auto-commits specs and plans.
- **grill-me / grilling** (distilled) — Chosen as the single clarify-first step (AGT-11) over superpowers' brainstorming and ponytail's 'ultra' pushback: it looks facts up itself, asks only decisions, orders questions by dependency and offers a recommended answer, which keeps quick mode cheap. Bounded per mode and given the client-mode branches (SEC-20, AZ-1, BL-2, HELP-1) because on its own it never stops and writes nothing down.
- **caveman** (distilled) — Only the 'brief chat' idea is distilled (AGT-15), with the guard caveman lacks: verification state is never compressed away (COR-1, AGT-13). Not installed: hooks read every prompt and transcript, the CLI sends telemetry by default, and 'no hedging' can turn 'should work' into 'yes'.
- **frontend-design** (companion) — The one pinned companion: prompt-only, vendor-maintained, and its design taste has no equivalent in the standard. Its mechanics (inline hex palettes, unstated font sources) conflict with §6A, so THEME-12 makes the token system its brief. Chosen over theme-factory, ui-ux-pro-max and baseline-ui, which impose fixed palettes or framework defaults (THEME-1/8).
- **skill-creator** (reference) — Reference only. Its with/without-skill eval method is worth using, but the loop runs nested `claude -p` sessions with full permissions and writes into .claude/commands/, and it encourages long skills that restate rules; AGT-16 records the safe way to use it.
- **docker-destructive-guardrails** (distilled) — Basis for AGT-17 because it states the behaviour precisely — say exactly what is lost, ask, exempt the agent's own fresh resources — and is prompt-only. Generalised from Docker to every destructive data and infrastructure command, and made mechanical with a hook, which no source provided.
- **Playwright test agents** (distilled) — Cited for the AGT-8 extension because it is the clearest real instance of the failure: its healer agent is told not to ask and to mark unfixable tests test.fixme(). Its generator guidance (role locators, no networkidle) is preferred over Anthropic's webapp-testing, which recommends networkidle waits.
- **code-modernization** (distilled) — Its proof discipline (a deliberate break must turn tests red; verdicts computed by a script, not judged) became TEST-15's 'fails at an assertion'. Preferred as the cited source over Trail of Bits' post-patch-validation markers, which express the same principle less directly. Not installed: Python hooks and telemetry.
- **Trail of Bits skills (agentic-actions-auditor)** (distilled) — Source for AGT-6's AI-in-CI vectors: the most systematic list of prompt-injection paths through workflows; Sentry's gha-security-review covers the same ground less completely and is recorded as supporting. CC-BY-SA, so ideas only. Not installed (hooks and an MCP server).
- **Sentry skills (gha-security-review, skill-scanner, iterate-pr)** (distilled) — Three narrow, well-specified skills: skill-scanner is the only source that lists the hidden surface (load-time commands, symlinks, auto-run tests) → AGT-5; iterate-pr's feedback loop → AGT-4 (the author filter is this standard's addition); gha-security-review supports AGT-6. Not installed.
- **ECC database-migrations** (distilled) — Chosen for COR-7 over wshobson's sql-migrations because it states the live-database checklist compactly (expand–contract, CONCURRENTLY, NOT NULL defaults, DDL/backfill split, immutable applied migrations). Only this skill was read; the ECC bundle and its large hook set are not installed.
- **Supabase agent skill** (distilled) — Vendor source, so its Supabase facts are authoritative (user_metadata is user-editable, UPDATE needs WITH CHECK, scoped tokens, sessions outlive deleted users). Distilled into SUPA-5 rather than pinned, so the facts have one owner beside SUPA-1…4.
- **firebase-security-rules-auditor** (distilled) — Vendor checklist for Firestore/Storage rules, which the standard did not cover (SEC-8 is Postgres RLS). Distilled into FB-3 rather than pinned because the skill is a red-team persona prompt, which the instruction-files rule avoids.
- **Vercel React best practices** (distilled) — Only its server-no-shared-module-state rule was new (NEXT-7, a cross-user data leak); its other 70 performance rules overlap PERF-14…26 and stay available through the installed Vercel plugin.
<!-- sources-rationale:end -->

"Distilled" means the idea was rewritten as a rule here, citing the source; none of that project's text or code is loaded by
agents. Its ideas are credited to its authors; the standard's wording, bounds and precedence are its own.

## Held back — not yet a source of any rule

Found by the v1.3 research but not confirmed from a primary source, so no rule depends on them (gap report §I/§J):
the Next.js 2026 security-release CVE IDs and the 15.5.27 / 16.3.8 version floors · the amended COPPA rule text · Android
developer verification scope · legacy Google Sign-In shutdown status · CISA 2025 SBOM minimum elements · age-assurance dates
in Utah, Louisiana and California · the EU AI Act Art. 50(2) watermark grace date · npm 12 and TypeScript 7 release dates ·
whether auto mode is Claude Code's default starting mode. Each becomes a rule only after its primary source is read.

## Internal sources

`SecureApplication.md` and `QA_PLAYBOOK.md` (the owner's earlier documents, superseded by v1.0) · a rule-inventory generator
from one of the owner's projects, the pattern behind `bin/build-rules.mjs --check` · the owner's staged-allowlist deploy
script, the pattern in WEB-1 ·
findings from the owner's own apps (kept in the git-ignored `local/findings/`) that
shaped the v1.3 "act now" list (gap report §A).

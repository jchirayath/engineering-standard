# Engineering Standard — Secure · Optimized · Shared · Observable (v2)

> The **minimum bar** every application under `~/code` is built to. Stack-agnostic. It answers
> *"what does good look like?"* — its companion [`APP_REVIEW.md`](APP_REVIEW.md) answers *"does this
> app meet it, and could a customer actually use it?"*
>
> **How to adopt in a repo:** add one line to the repo's `CLAUDE.md` —
> `Follow ~/code/ENGINEERING_STANDARD.md. Deviations are listed in docs/STANDARD_EXCEPTIONS.md.` —
> then fill in §1 (the platform-core map) for that repo. Every rule has an ID (`SEC-4`, `LOG-2`…) so
> review findings, PRs and exceptions can cite it.
>
> **Keywords.** **MUST** = blocking; violating it is a finding. **SHOULD** = default; deviate only with
> a written reason in `docs/STANDARD_EXCEPTIONS.md`. **Enforced by** = the tool that makes the rule
> mechanical. *A rule with no enforcement is a wish* — prefer adding a guard over adding a sentence.

Supersedes: `SecureApplication.md` (controls), `QA_PLAYBOOK.md` (build-time rules). Review procedure
lives in `APP_REVIEW.md`. Tooling lives in [`~/code/engineering-standard/`](README.md).

**Quick start (per repo, ~10 minutes):**
```bash
~/code/engineering-standard/bin/adopt.sh ~/code/<app>   # lint rules, token tooling, design/ template, exceptions file
cd ~/code/<app> && tools/standard/check.sh --baseline    # record today's violations; only NEW ones fail
# add the CLAUDE.md line above + the CI job from the kit README; fill in §1 for this repo
~/code/engineering-standard/bin/adopt.sh ~/web/<site> --site swa|netlify|apache|caddy|nginx --url https://<domain>   # websites
```
**New vs existing repo:** a new repo is blocking from commit 1; an existing repo measures first
(`APP_REVIEW.md` quick + `--baseline`), fixes P0s, then burns the baseline down. Step-by-step runbooks for
new/existing **apps** and **websites** are in the
[kit README](README.md#running-the-standard-new-repo-vs-existing-repo).

---

## 0 · The four non-negotiables

| # | Pillar | One-line bar |
|---|---|---|
| 1 | **Secure** | Deny by default; validate at every boundary; no secret ever reaches a client, a log, or git. |
| 2 | **Optimized** | Every request, query, list and bundle has a budget, a timeout and a bound — measured, not guessed. |
| 3 | **Shared** | Each cross-cutting concern has **exactly one** blessed module, and a lint rule forbids going around it. |
| 4 | **Observable** | One logging call emits a structured, correlated, redacted event — and the audit trail rides on it. |

Websites additionally meet the **secure build & deploy profile** in §2A, checked at creation, on every
deploy and weekly against the live URL.

---

## 1 · Platform core — the shared modules every app MUST have

The single biggest source of security, logging and consistency defects is a concern implemented
twice. Each concern below has **one** entry point; everything else imports it. Fill in the right
column per repo (it becomes the review's "shared seams" table).

| ID | Concern | The one module does… | Banned elsewhere (lint-enforced) | This repo |
|---|---|---|---|---|
| CORE-1 | **Config** | Typed, validated-at-boot config; fails fast on missing/invalid; documents every key. | `process.env`, `os.Getenv`, `os.environ` outside it | `{{path}}` |
| CORE-2 | **Secrets** | Fetches from vault/Keychain/Key Vault/KMS; caches in memory; never logs values. | Reading secrets from env/disk directly | |
| CORE-3 | **Logger / telemetry** | Structured logs + traces per §5 (LOG-*). | `console.log`, `print`, `fmt.Println`, `log.Printf` | |
| CORE-4 | **Audit / activity** | `record(ctx, event, outcome, attrs)` → app log + audit + activity in one call. | Ad-hoc audit inserts | |
| CORE-5 | **AuthN / AuthZ** | Identity accessor + `can(actor, action, resource)`; the only choke point. | Inline role string checks | |
| CORE-6 | **Outbound HTTP** | Timeouts, retries w/ backoff+jitter, circuit-break, SSRF guard, trace propagation, redacted logging. | Raw `fetch`/`axios`/`http.Get`/`requests` | |
| CORE-7 | **Errors** | Typed errors with stable codes (`DOMAIN_REASON`); maps to HTTP status + safe client message. | Throwing/returning raw strings to clients | |
| CORE-8 | **Persistence** | Store interface, parameterized queries, migrations convention, tenant scoping. | Raw SQL string building, ORM calls from handlers | |
| CORE-9 | **Validation** | Schema at every boundary (zod / pydantic / go-playground / json-schema); shared with client. | Hand-rolled field checks | |
| CORE-10 | **Background jobs** | Registry with schedule, lease/lock, idempotency key, last-run + status surfaced to UI. | Bare goroutines/`setInterval`/cron scripts | |
| CORE-11 | **UI primitives** | Grid/table (filter, sort, page, **export**), page chrome, empty/error/loading states, tokens. | Hand-rolled tables, raw hex colors | |
| CORE-12 | **Data fetch (client)** | One fetch hook + response envelope (`{data, error:{code,message}, meta}`). | Ad-hoc `fetch` in components | |
| CORE-13 | **Theme, tokens & icons** | Generated from the app's one token source + icon registry (§6A); semantic tokens, light/dark/preset switching. | Raw hex/rgb, `Colors.*`, palette classes (`bg-red-500`), `fontSize`/spacing literals, direct icon-package imports | |
| CORE-14 | **Notifications** | One sender for email/push/SMS: templates, per-user preferences, retry, `record()` on send. | Direct SMTP/FCM/APNs calls | |
| CORE-15 | **Feature flags / kill switch** | Central flag read (remote or DB), typed, defaulted, with expiry; min-version check for clients. | `if (env === 'prod')` branching | |
| CORE-16 | **Help registry** | One registry keyed by route/screen + field id: screen help, field help, empty-state copy, tour steps, doc links (§6G). | Help text hard-coded in screens | |

**SHR-1 MUST** — a new cross-cutting concern gets a core module *before* its second caller exists.
**SHR-2 MUST** — the "banned elsewhere" column is enforced by a lint rule (see §7), not by review.
**SHR-3 SHOULD** — multi-app shared code (e.g. a Go/TS core shared by several services) is a
versioned package, not a copy. Copies drift; drift becomes CVEs.
**SHR-4 MUST** — core modules have their own unit tests and a README with the one-paragraph contract.

---

## 2 · Secure code (baseline: OWASP ASVS 5.0 Level 2)

### Boundaries & input
- **SEC-1 MUST** Validate every external input (HTTP, queue message, file, webhook, LLM output) against
  a schema at the boundary (CORE-9). Reject; don't sanitize-and-continue.
- **SEC-2 MUST** Parameterized queries only. No string-built SQL/NoSQL/shell/LDAP. No `eval`, no
  `exec` of user-influenced strings.
- **SEC-3 MUST** Output-encode by context (HTML, attribute, URL, JS). Framework auto-escaping stays
  on; every `dangerouslySetInnerHTML`/`| safe`/`v-html` is justified inline.
- **SEC-4 MUST** File uploads: size cap, content-type sniffing (not extension), stored outside web
  root / in object storage with random names, scanned if user-shared.
- **SEC-5 MUST** All outbound calls go through CORE-6, which blocks private/link-local/metadata IPs
  unless allow-listed (SSRF).

### Identity & access
- **SEC-6 MUST** Authorization is **deny-by-default** and enforced **server-side** at one choke point
  (CORE-5) on **every** mutation and every read of non-public data. Client-side gating is UX only.
- **SEC-7 MUST** Every resource access checks **ownership/tenant** (no IDOR). Identity is derived
  from the token on the server — never from a request field.
- **SEC-8 MUST** Row-level security (or equivalent) on every user-owned table, one policy per
  operation, default-deny. `SECURITY DEFINER` functions re-check authz and pin `search_path`.
- **SEC-9 MUST** Sessions: short-lived access tokens, rotating refresh, `HttpOnly; Secure;
  SameSite=Lax|Strict` cookies, CSRF protection on cookie-auth mutations, MFA available for admins,
  rate-limited login with lockout/backoff. Passwords (if any) hashed with Argon2id/bcrypt.
- **SEC-10 MUST** No mass assignment — map request DTOs to models explicitly.

### Secrets & data
- **SEC-11 MUST** Zero secrets in git (history included), client bundles, mobile artifacts, source
  maps, logs, URLs, or error messages. Client config is an **allow-list** of public keys; a build
  step fails if anything else appears.
- **SEC-12 MUST** Encryption in transit (TLS 1.2+, HSTS) and at rest for sensitive data; keys in a
  KMS/vault, rotated; a written **rotation runbook** (redeploying does not un-leak a credential).
- **SEC-13 MUST** Data inventory: every PII/sensitive field is classified, has a retention period
  and a deletion path; data-subject export/delete exists where law applies.
- **SEC-14 MUST** Security headers: CSP (no `unsafe-inline` for scripts), HSTS, `X-Content-Type-Options`,
  `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`; CORS is an explicit allow-list.
  Debug endpoints, stack traces and prod source maps are off.

### Supply chain & infra
- **SEC-15 MUST** Lockfiles committed; dependencies updated by Renovate/Dependabot; **no Critical/High
  known CVE** in shipped deps (`osv-scanner`, `govulncheck`, `npm audit`, `pip-audit`).
- **SEC-16 SHOULD** SBOM generated per release (`syft`); container images scanned (`trivy image`);
  base images pinned by digest; run as non-root.
- **SEC-17 MUST** CI actions pinned to a commit SHA; workflows lint-clean under `zizmor`; least-privilege
  `permissions:` block; no secrets exposed to PR builds from forks.
- **SEC-18 MUST** IaC scanned (`trivy config` / `checkov`): no public buckets, no `*` IAM, no open
  management ports, no default credentials.

### AI / LLM features (if any)
- **SEC-19 MUST** Treat model output as untrusted input (SEC-1/3). Tools exposed to a model run with
  least privilege, and destructive tools require human confirmation. Retrieved/user content is
  never concatenated into the system prompt as instructions (prompt-injection). Log prompts/outputs
  only through the redactor. Map against OWASP Top 10 for LLM Applications.

### Threat model
- **SEC-20 MUST** Each app keeps a one-page `docs/THREAT_MODEL.md`: assets, actors, trust boundaries,
  top abuse cases (STRIDE is fine), and which control above mitigates each. Updated when a trust
  boundary changes.


### Implementation pitfalls (the bugs that keep shipping)
- **SEC-21 MUST** Tokens, IDs used as secrets, reset codes and nonces come from a **CSPRNG**
  (`crypto.randomBytes`/`crypto.getRandomValues`, Go `crypto/rand`, Python `secrets`, Dart
  `Random.secure()`) — never `Math.random`, `math/rand`, `random`, `Random()`.
- **SEC-22 MUST** Passwords are hashed with **Argon2id** (or bcrypt/scrypt) via a maintained library —
  never a bare `md5/sha1/sha256(salt + password)`. Secret comparisons are constant-time
  (`crypto.timingSafeEqual`, `hmac.compare_digest`, `subtle.ConstantTimeCompare`).
- **SEC-23 MUST** JWTs are **verified**, never just decoded: pinned algorithm (no `none`, no
  HS/RS confusion), `iss`, `aud`, `exp`, `nbf` checked, keys from JWKS with caching and rotation.
- **SEC-24 MUST** Inbound webhooks verify the provider's signature (HMAC over the raw body, constant-time,
  with a timestamp tolerance) before parsing; replays are rejected by event id.
- **SEC-25 MUST** OAuth/OIDC uses Authorization Code + **PKCE** with `state` and `nonce`; redirect URIs are
  exact-match allow-listed; no implicit flow.
- **SEC-26 MUST** File paths from input are resolved and confirmed inside an allowed root (no `../`,
  no absolute paths, no symlink escape); archive extraction checks every entry (zip-slip).
- **SEC-27 MUST** No unsafe deserialization: no `pickle`/`yaml.load`/`Marshal`/Java serialization of
  untrusted data; XML parsers have external entities and DTDs disabled (XXE).
- **SEC-28 MUST** Redirects to user-supplied URLs go through an allow-list (open redirect); user input
  never reaches a regex without a length cap and a linear-time engine or timeout (ReDoS); shell commands
  take argument arrays, never `shell=True`/string concatenation.
- **SEC-29 MUST** Log injection: CR/LF and control characters in user input are escaped by the logger
  (CORE-3), never written raw.
- **SEC-30 MUST** Least-privilege runtime identities: the app's DB role cannot `DROP`/`ALTER`/`GRANT`,
  migrations run as a separate role; cloud identities (managed identity / service account) are scoped
  to the resources they touch; no long-lived keys where workload identity exists.
- **SEC-31 MUST** **AI-assisted code** is reviewed like any other code and must pass the same gates.
  Every dependency an AI suggests is verified to exist, be the intended package and be maintained
  before install (slopsquatting / typosquatting); generated code never weakens a control to make a
  test pass.
- **SEC-32 SHOULD** Releases are reproducible and signed (tags signed; build provenance via GitHub
  artifact attestations / SLSA); production deploys only from CI, never from a laptop.

---

## 2A · Websites — secure build & deploy profile

Applies to every site, static or dynamic, on any host (Azure Static Web Apps, Netlify, cPanel/Apache,
Caddy, nginx). Enforced at **three points**: when the site is **created** (`adopt.sh --site`, then
`harden.mjs` to apply the profile), on every **deploy** (`check-build.mjs` before upload — including CSP
drift — and `check-site.mjs` after), and **weekly** against every live hostname (`fleet/sites.json`;
failures open a GitHub issue), so certificate, DNS, vulnerability and analytics drift is caught even
when nobody deploys. Every finding carries a one-line fix; header/exposure fixes are applied by
`harden.mjs`, never hand-edited.

- **WEB-15 MUST** **Analytics coverage:** every public page carries the site's analytics tag with the
  expected property ID (from the fleet config), and the CSP allows it. `check-site.mjs` crawls the site
  and reports pages without it. Preview/staging hosts must never report to production properties.
- **WEB-16 MUST** **Known-vulnerable front-end libraries** are not shipped: detected library versions
  are checked against OSV on every run; a hit is an ERROR until upgraded or removed. Server software
  (PHP, CMS core) must be on a supported release (endoflife.date).

- **WEB-1 MUST** **Ship an allowlist, not a folder.** The deploy copies only listed public files into a
  staging directory and uploads that (pattern: `a staged-allowlist deploy.sh`). Repo roots are never document
  roots. `check-build.mjs <stage>` runs before upload and **aborts the deploy** on any private file:
  `.git`, `.env*`, keys, backups, DB dumps, logs, server code, auth/secret files, lockfiles, deploy scripts.
- **WEB-2 MUST** HTTPS only: http → https with 301/308 on every hostname, TLS 1.2+, valid certificate
  with automated renewal and an expiry alert (Uptime Kuma / check-site warns under 30 days).
- **WEB-3 MUST** Security headers on every response, from the kit template for the host
  (`site/headers/`): **CSP** with no `'unsafe-inline'`/wildcards in `script-src`, `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'none'` (or a named allowlist); **HSTS** ≥ 1 year with
  `includeSubDomains`; `X-Content-Type-Options: nosniff`; `Referrer-Policy:
  strict-origin-when-cross-origin`; `Permissions-Policy` denying unused features; no version-disclosing
  `Server`/`X-Powered-By`. New CSPs roll out as `-Report-Only` for one deploy, then enforce. No inline
  `on*=` handlers or inline scripts — move them to files (or hash them).
- **WEB-4 MUST** Cookies `Secure`, `SameSite`, and `HttpOnly` for anything session-like. Static sites
  set no cookies except consented analytics.
- **WEB-5 MUST** No mixed content: every script, stylesheet, iframe, image and form action is https.
- **WEB-6 MUST** Third-party scripts/styles are minimized, listed in the CSP by exact origin, and pinned
  with **Subresource Integrity** where the provider serves static files (GA4/Google Fonts are exempt —
  they can't be pinned). Prefer self-hosting fonts and libraries.
- **WEB-7 MUST** No public source maps in production; build tools set `sourcemap: false` (or upload maps
  privately to the error tracker).
- **WEB-8 MUST** Nothing private is reachable: directory listing off; VCS/env/backup/config files return
  404/403 (the host config blocks them even if one slips into the upload); admin/editor surfaces never
  live on the public host — list them in `standard.config.json → site.forbid` so the post-deploy check
  proves they 404. Config files for a *different* server (an `.htaccess` on Caddy) are not shipped.
- **WEB-9 SHOULD** `/.well-known/security.txt` with a monitored `Contact:` and an `Expires:`.
- **WEB-10 SHOULD** DNS hygiene on the registrable domain: CAA (limit CAs), SPF (`v=spf1 -all` if it
  sends no mail), DKIM where mail is sent, DMARC moving from `p=none` to `quarantine`/`reject`, DNSSEC
  where the registrar supports it; registrar lock and MFA on the registrar/DNS account.
- **WEB-11 MUST** No secrets in shipped files — only public keys (analytics IDs, anon/publishable keys,
  OAuth client IDs). `check-build.mjs` scans for private keys, cloud/API tokens, DB URLs with passwords
  and elevated-role JWTs (e.g. Supabase `service_role`).
- **WEB-12 MUST** Forms and endpoints: server-side validation (SEC-1), rate limiting and bot protection
  (honeypot or Turnstile/hCaptcha) on public forms, CSRF protection on cookie-authenticated posts, and
  mail sent through CORE-14 — never a mail relay exposed to the form.
- **WEB-13 MUST** Dependencies of a built site (npm/composer) pass SEC-15; CMS sites (WordPress) run
  auto-updates for core/plugins, have XML-RPC and file editing disabled, and admin behind MFA.
- **WEB-14 SHOULD** Privacy: analytics only after consent where the audience requires it; privacy page
  linked from the footer; no third-party trackers beyond what the privacy page lists.

**Gate:** a deploy is complete only when `check-site.mjs` passes with **zero ERRORs** on every hostname
the site answers on. WARNs are tracked in `docs/STANDARD_EXCEPTIONS.md` or fixed.

---

## 3 · Optimized code

Budgets are defaults — override per app in §1, but **every app has numbers**.

- **PERF-1 MUST** Budgets written down and checked in CI where possible:
  API p95 ≤ **300 ms** (reads) / **800 ms** (writes) · web LCP ≤ **2.5 s**, INP ≤ **200 ms**,
  CLS ≤ **0.1** · initial JS ≤ **200 KB gz** · mobile cold start ≤ **2 s** on a mid-tier device.
- **PERF-2 MUST** Every network/DB/queue call has a **timeout**; every retry has backoff + jitter + a
  cap; every external dependency has a fallback or a loud failure (never a hang).
- **PERF-3 MUST** Every list endpoint is **paginated** (cursor preferred) with a max page size. No
  unbounded `SELECT *`, no loading a collection to count it.
- **PERF-4 MUST** No N+1 queries; every filter/sort column used by a query is indexed; slow-query log
  on in non-prod. Run `EXPLAIN` on any new query touching a large table.
- **PERF-5 MUST** Concurrency is bounded (worker pools, semaphores); shared state uses locks /
  upserts / idempotency keys / leases — never last-write-wins. Safe under >1 replica.
- **PERF-6 SHOULD** Cache only with an explicit key, TTL and invalidation rule; never cache across
  tenants; cache hit/miss is a metric.
- **PERF-7 MUST** Clients: virtualized/lazy lists, images sized and cached at display resolution,
  code-split by route, subscriptions/streams disposed on unmount.
- **PERF-8 MUST** **Profile before optimizing.** A perf change cites a before/after measurement.
- **PERF-9 MUST** Simplicity is a performance feature: no dead code, no unused deps, no speculative
  abstraction, no feature flags older than 90 days. (`/simplify`, `knip`, `deadcode`, `vulture`.)


### Backend & data
- **PERF-10 MUST** Connection pooling for every DB/HTTP client (sized to the DB's limits); HTTP
  keep-alive / HTTP/2; prepared statements for hot queries.
- **PERF-11 MUST** No unbounded work on the request path: anything > ~200 ms or touching third parties
  in bulk goes to a background job (CORE-10); large exports stream instead of buffering.
- **PERF-12 MUST** Know the complexity: no O(n²) over user-controlled n; batch DB writes and external
  calls; select only the columns you use; covering indexes for the top queries; archive or partition
  tables that grow without bound.
- **PERF-13 SHOULD** Cache in layers with explicit ownership — CDN (static, hashed assets), HTTP
  (`ETag`/`Cache-Control`), application (keyed, TTL'd, tenant-scoped), DB — and measure hit rates.

### Web front end
- **PERF-14 MUST** Static assets have content-hashed filenames and `Cache-Control: public,
  max-age=31536000, immutable`; HTML is `no-cache` (revalidate). Compression (br/gzip) on text.
- **PERF-15 MUST** Images: modern formats (AVIF/WebP), `width`/`height` set (no layout shift),
  responsive `srcset`/`sizes`, `loading="lazy"` below the fold, `fetchpriority="high"` on the LCP image.
- **PERF-16 MUST** Fonts: self-hosted WOFF2, subset, `font-display: swap`, the 1–2 critical files
  preloaded; no more than two families.
- **PERF-17 MUST** JavaScript budget enforced in CI (`size-limit` / bundle analyzer); route-level code
  splitting; third-party scripts loaded `async`/`defer`, each one justified (it costs performance,
  privacy and CSP surface); no render-blocking scripts in `<head>`.
- **PERF-18 SHOULD** Real-user monitoring of Core Web Vitals (`web-vitals` → analytics) so budgets are
  checked against real devices, not just Lighthouse.

### Mobile (Flutter / native)
- **PERF-19 MUST** Flutter: `const` constructors wherever possible; rebuild only what changed
  (`select`/granular providers, no `setState` at the root); heavy work (parsing, crypto, image
  processing) in an isolate (`compute`/`Isolate.run`); lists via `ListView.builder`; images decoded at
  display size (`cacheWidth`/`cacheHeight`); startup work deferred until after first frame.
- **PERF-20 MUST** Profile in **profile/release mode** on a real mid-tier device (DevTools, Instruments,
  Android Studio profiler) — debug builds lie about performance.

### Measurement
- **PERF-21 MUST** Each stack's profiler is part of the toolkit and used before optimizing:
  Go `pprof`, Node `--cpu-prof`/clinic, Python `py-spy`/`scalene`, Flutter DevTools, Chrome Performance
  panel, `EXPLAIN (ANALYZE, BUFFERS)` for SQL. Regressions in PERF-1 budgets fail CI.

---

## 3A · Clean code & maintainability

Code is read far more than it is written; these rules keep it cheap to read, change and review.

- **CLEAN-1 MUST** **Strict types everywhere:** TS `strict` + `noUncheckedIndexedAccess`, no `any`
  (use `unknown` + narrowing); Dart `strict-casts`/`strict-inference`/`strict-raw-types`; Python typed
  and `mypy --strict`/`pyright strict` on new code; Go vet-clean. Typed IDs (`UserId`, not `string`)
  for anything crossing a boundary.
- **CLEAN-2 MUST** **Complexity limits, lint-enforced:** cyclomatic ≤ 10 per function (≤ 15 with a
  comment explaining why), cognitive complexity ≤ 15, functions ≤ ~50 lines, files ≤ ~400 lines,
  ≤ 4 parameters (use an options object), nesting ≤ 3. Exceeding one is a refactor signal, not a target.
- **CLEAN-3 MUST** **Layering with enforced dependency direction:** UI → application → domain ←
  infrastructure. The domain has no framework, DB or HTTP imports; no circular dependencies.
  Enforced by `dependency-cruiser` (TS), `import-linter` (Python), `go-arch-lint`/`depguard` (Go),
  `custom_lint`/import rules (Dart).
- **CLEAN-4 MUST** **Names say what, not how:** functions are verbs, booleans read as predicates
  (`isExpired`, `hasAccess`), no abbreviations beyond the domain's own, units in names where ambiguous
  (`timeoutMs`). One concept, one name across the codebase (and the same name in the UI and help).
- **CLEAN-5 MUST** **No dead weight:** no commented-out code, no unused exports/deps (`knip`,
  `deadcode`, `vulture`, `dart fix`), no `TODO` without an issue link and owner, no speculative
  parameters or abstractions with one implementation.
- **CLEAN-6 MUST** **Errors are explicit:** expected failures are typed results or typed errors
  (CORE-7), not exceptions for control flow; every error carries context on the way up
  (`fmt.Errorf("load invoice %s: %w", id, err)`); no catch-and-ignore (COR-3).
- **CLEAN-7 SHOULD** **Immutability and pure functions by default:** domain logic is pure and
  data is immutable (`final`, `readonly`, frozen dataclasses); side effects live at the edges where they
  are easy to test and log.
- **CLEAN-8 MUST** **Comments explain why, not what;** public functions/types of shared modules have
  doc comments with an example; an ADR records any decision that constrains future work.
- **CLEAN-9 MUST** **Small, reviewable changes:** PRs ≤ ~400 changed lines of non-generated code, one
  concern each; generated files and lockfiles reviewed separately. Every PR states which standard rules
  it touches and links tests (PR template).
- **CLEAN-10 MUST** **Adding a dependency is a decision:** check it is maintained (release in the last
  year), widely used, licence-compatible (REPO-4), small, and not replaceable by ~20 lines of code or
  the platform; record why in the PR. Dependencies are updated on a schedule (Renovate, grouped,
  weekly) — not in a yearly panic.
- **CLEAN-11 MUST** **Formatting is automatic and non-negotiable** (`gofmt`, `prettier`, `dart format`,
  `ruff format`, `swift-format`); no style debates in review.
- **CLEAN-12 SHOULD** **Review checklist** (in the PR template): correctness and edge cases · authz on
  every new path · input validation · logging/audit via the core · tests of all four kinds · help/docs ·
  performance of new queries · no new dependency without CLEAN-10 · no secrets · standard rule IDs.

---

## 4 · Correctness & honesty

- **COR-1 MUST** **Never fabricate success.** If code cannot perform an action (no driver, no
  credential, no backend) it returns an explicit error — never a plausible "ok". Mocks/simulators
  are impossible to select in production builds.
- **COR-2 MUST** Demo/seed data is gated behind an explicit flag, visibly labelled in the UI, and
  never mixed into real aggregates.
- **COR-3 MUST** No silent `catch {}` / ignored errors. Every catch logs (LOG-*) or rethrows with context.
- **COR-4 MUST** Multi-step writes are transactional; deletes are intentional (cascade vs soft) and
  documented.
- **COR-5 MUST** Everything wired is reachable: routes registered, workers started at boot, endpoints
  called by something. Unreachable code is deleted, not kept "for later".
- **COR-6 MUST** Every user-tunable runtime parameter has a UI (or is documented as deploy-only).
- **COR-7 MUST** Migrations are forward-only-safe with a tested rollback; dry-run in a transaction
  with `ON_ERROR_STOP` before prod. Event/API payloads are versioned.

---

## 5 · Unified logging, audit & telemetry

One call, one schema, every service, every platform.

### LOG-1 · The event schema (MUST — every log line is JSON with these fields)

| Field | Required | Notes |
|---|---|---|
| `ts` | ✅ | RFC 3339 UTC, ms precision |
| `level` | ✅ | `debug` · `info` · `warn` · `error` (see LOG-3) |
| `service`, `version`, `env` | ✅ | `version` = git SHA or semver; set once at logger init |
| `event` | ✅ | Stable dotted name: `invoice.create`, `auth.login`, `job.scan.finish` — the thing you query |
| `msg` | ✅ | Human sentence; no data interpolated that isn't also a field |
| `trace_id`, `span_id` | ✅ | W3C Trace Context; propagated across HTTP/queues by CORE-6 |
| `request_id` | ✅ for requests | Echoed in the `X-Request-Id` response header and in client error UIs |
| `actor_id`, `actor_role` | ✅ when authenticated | **Two fields.** Roles are shared — role alone can't answer "which admin?" |
| `tenant_id` | ✅ if multi-tenant | |
| `outcome` | ✅ for actions | `success` · `failure` · `denied` |
| `error_code` | ✅ on failure | Stable CORE-7 code, never a free-text message |
| `duration_ms` | for timed ops | |
| `attrs` | optional | Event-specific, flat, redacted |

### Rules
- **LOG-2 MUST** All logging goes through CORE-3. Recommended implementations:
  Go `log/slog` (JSON handler) · Node `pino` · Python `structlog` (or stdlib + JSON formatter) ·
  Swift `os.Logger` + remote sink · Flutter/Dart `package:logging` → backend sink ·
  traces/metrics via **OpenTelemetry** SDK, exported over OTLP.
- **LOG-3 MUST** Level discipline: `error` = someone should look (alertable); `warn` = degraded but
  handled; `info` = business events and request summaries; `debug` = off in prod by default,
  switchable at runtime without redeploy.
- **LOG-4 MUST** **Redaction at the logger**, not the call site: a denylist of keys
  (`password|secret|token|authorization|cookie|api[_-]?key|ssn|card`) plus value-pattern scrubbing
  (JWTs, bearer tokens, long hex/base64). PII is hashed or omitted. Unit-test the redactor.
- **LOG-5 MUST** **Audit rides on logging.** `record()` (CORE-4) emits one event that lands in
  (a) the app log, (b) the **append-only** audit store for every state change and privileged read,
  and (c) the user-visible activity feed where relevant. Audit records carry who/what/when/from-where
  (IP, user-agent)/outcome and are immutable to the app (DB role without UPDATE/DELETE; optional hash chain).
- **LOG-6 MUST** **Producer coverage**: every subsystem that mutates state calls `record()`. A
  dashboard or audit log fed by 9 of 63 subsystems is worse than none. Keep a producer × sink table
  in `docs/OBSERVABILITY.md`.
- **LOG-7 MUST** Every request emits exactly one summary line (`http.request`: method, route
  template — not raw path —, status, duration, bytes) plus spans for downstream calls.
- **LOG-8 MUST** Client apps: crash reporter live with release tag and uploaded symbols; client errors
  carry `request_id`; no raw `print`/`console` in release builds.
- **LOG-9 MUST** Logs are centralized, retained per policy (default 30 d app / 1 y audit), access-
  controlled, and alerting exists for: error-rate spike, auth-failure spike, job not run on schedule,
  audit-write failure.
- **LOG-10 SHOULD** Golden signals per service as metrics (latency, traffic, errors, saturation) with
  one dashboard; job freshness (`last_success_ts`) exported per job.

---

## 6 · UX consistency, accessibility, docs

- **UX-1 MUST** Every screen uses CORE-11 page chrome and implements all four states: loading, empty,
  error (actionable, shows `request_id`), data.
- **UX-2 MUST** All colour, type, spacing, radius, elevation and icons come from CORE-13 per §6A.
- **UX-3 MUST** Lists: drill-down to the item, filter, sort, paginate, **export** (CSV/JSON) — free via
  the shared grid.
- **UX-4 MUST** Inputs that reference existing objects are **pickers bound to real data**, not free text.
- **UX-5 MUST** WCAG 2.2 AA: labels on icon buttons, contrast in both themes, keyboard navigation,
  focus visible, tap targets ≥ 44pt / 48dp, text scales to 200% without clipping.
- **UX-6 SHOULD** One formatting helper each for money, numbers, dates (locale from data); strings
  externalized for i18n; `mailto:` built with RFC 3986 encoding (`%20`, not `+`).
- **UX-7 MUST** Every screen and field has in-app help and a living-docs page per §6G.
- **UX-8 MUST** Network resilience: offline/slow/5xx states are graceful; token expiry triggers silent
  refresh; reconnect backfills missed realtime state.

---

## 6A · Design system & theming — central management *per app*

**Each app owns its look** — its own palette, typography, icons and brand. What is standard is the
*method*: inside an app there is **one** token source and **one** icon registry, every screen goes
through them, and the same meaning always gets the same colour and the same icon. Nothing is shared
between apps except the structure, the semantic names and the tooling.

```
<repo>/design/                        ← the app's ONE theme source
  tokens/primitive.json               ← this app's raw palette: brand.600 = #0F766E, space.4 = 16 …
  tokens/semantic.light.json          ← color.bg.surface → {neutral.50}, color.status.danger → {red.700}
  tokens/semantic.dark.json           ← same keys, dark values
  tokens/presets/<name>.json          ← optional user-selectable colour presets (same keys)
  icons.json                          ← semantic icon name → glyph: "action.delete" → trash, "status.warning" → alert-triangle
  build/ (generated, never hand-edited)
    css/tokens.css · tailwind/preset.js · dart/app_tokens.dart · swift/Tokens.swift · icons.(ts|dart|swift)
```

- **THEME-1 MUST** Each app has exactly **one** token source, authored in the W3C **Design Tokens**
  (DTCG) JSON format and generated for its platform(s) by the kit's zero-dependency
  `tools/standard/design-tokens/scripts/build.mjs` (CSS vars, Tailwind preset, TS, Flutter
  `ThemeExtension`, SwiftUI). DTCG keeps the source compatible with Style Dictionary and Tokens Studio
  (Figma) if a designer joins. A web + mobile app generates both from the same source, so they match. Generated files are never hand-edited. Two theme/colour files in one app (e.g.
  `theme_colors.dart` *and* `app_colors.dart`) is a finding.
- **THEME-2 MUST** Two tiers: **primitive** tokens (this app's palette, scale) and **semantic** tokens
  (`color.bg.surface`, `color.text.muted`, `color.status.danger`, `color.border.focus`,
  `color.action.primary`). App code references **semantic tokens only**. Light, dark and each preset are
  different semantic maps over the same keys.
- **THEME-3 MUST** **Consistency within the app:** a meaning maps to one token everywhere — the same
  "danger", "success", "selected", "disabled", "link" on every screen, chart and badge. Domain colours
  (e.g. per category, per segment, per player) are semantic tokens too (`color.category.music`), defined
  once, never re-picked per screen.
- **THEME-4 MUST** **Shared semantic vocabulary across apps:** every app uses the *same token names*
  (its values are its own). This keeps the lint rules, the review harness and the contrast checker
  identical everywhere, and lets a developer move between apps without relearning. The canonical
  key and icon list is `engineering-standard/design-tokens/schema/semantic-keys.json`; apps may add
  keys under `color.domain.*` / `icon.domain.*`, never rename. `validate.mjs` enforces this.
- **THEME-5 MUST** **Icons through a registry:** the app picks **one** icon set per platform (e.g.
  Lucide, Material Symbols, SF Symbols) and exposes semantic names (`action.delete`, `action.edit`,
  `nav.settings`, `status.warning`). Screens use the registry, never the icon package directly — so
  "delete" is the same glyph, size and colour token everywhere. Icon sizes are tokens
  (`icon.sm|md|lg`). App icon, splash and favicon are generated from one source per app.
- **THEME-6 MUST** Theme mode = `system | light | dark` (+ the app's presets if offered), held by one
  theme controller (CORE-13), persisted **per user** in the backend profile (local cache for first
  paint), applied before first render (no flash), switchable at runtime without restart.
- **THEME-7 MUST** Contrast is validated **at token build time**: every text/background semantic pair
  meets WCAG AA (4.5:1 body, 3:1 large text/UI) in every mode and preset; the build fails otherwise.
- **THEME-8 MUST** No raw colours, font sizes, spacing values or direct icon-package imports in screen
  code (lint, §7.2). Third-party components are themed through an adapter that maps them to tokens —
  including a dark bridge.
- **THEME-9 MUST** Visual regression in **both modes**: golden tests (Flutter) / Playwright screenshots
  (web) for a smoke set of screens per mode and preset, in CI.
- **THEME-10 SHOULD** Typography, spacing, radius, elevation, motion and breakpoints are tokens too.
- **THEME-11 SHOULD** A living reference page per app (Storybook / Widgetbook / a `/design` route in
  dev builds) renders every token, icon and shared component in every mode.

**Migration path for an existing app:** (1) map its current palette into `primitive` + `semantic`
files; (2) generate and swap the app's theme file for the generated one; (3) enable the banned-colour
lint as **warn**, codemod the hits to semantic tokens, (4) flip the rule to **error**.

---

## 6B · API contract

- **API-1 MUST** The API contract is a checked-in schema (OpenAPI 3.1 / GraphQL SDL / protobuf / typed
  RPC) that is the source of truth; clients and validators are generated from it, and CI fails on drift.
- **API-2 MUST** Versioned routes or additive-only changes; breaking changes need a new version and a
  deprecation window long enough for shipped mobile clients.
- **API-3 MUST** Every mutating endpoint that can be retried accepts an **idempotency key**.
- **API-4 MUST** **Rate limiting and quotas on every public endpoint** (per user, per IP, per tenant),
  stricter on auth, signup, password reset, OTP, file upload and anything that costs money (LLM, SMS).
- **API-5 MUST** One error envelope everywhere (CORE-7/CORE-12): `{error:{code, message, request_id}}`.

## 6C · Mobile & client security

- **MOB-1 MUST** Tokens/keys only in the platform secure store (Keychain / Android Keystore via
  `flutter_secure_storage` or equivalent) — never SharedPreferences/UserDefaults/localStorage.
- **MOB-2 MUST** ATS on (iOS) / `cleartextTrafficPermitted=false` (Android); no debug flags or
  verbose logging in release; screenshots hidden for sensitive screens where appropriate.
- **MOB-3 MUST** Deep-link and push payloads are validated as untrusted input (SEC-1) and never
  carry secrets.

---

## 6D · Testing standard — tests are part of the feature

**A feature is not done until its tests exist, run in CI, and pass.** Writing them is part of building
the feature — in the same PR, by whoever builds it (person or Claude) — not a follow-up ticket.

- **TEST-0 MUST** Every new or changed feature/screen ships with **four kinds of test** in the same PR:

  | Kind | Proves | Typical tooling |
  |---|---|---|
  | **Unit** | Its logic, validation, formatting, state transitions — including edge cases (0 / 1 / max, invalid input) | `go test`, `vitest`/`jest`, `pytest`, `flutter test`, XCTest |
  | **Integration** | Each API/mutation against a real DB/emulator: happy path **and the denied path** (wrong role, other user's/tenant's record), transaction rollback, audit event written | testcontainers, Supabase local, Firebase emulator |
  | **E2E journey** | The main task end to end through the real UI, per role (e.g. member creates → admin approves) | Playwright, Flutter `integration_test`, XCUITest |
  | **Walkthrough** | The Day-1 walk of the screen (APP_REVIEW §4), automated — see TEST-6 | same as e2e |

- **TEST-1 MUST** Pyramid: many unit, fewer integration, fewest e2e/walkthrough. No production data in
  fixtures — use factories and a seeded test tenant.
- **TEST-2 MUST** Every mutation has a test for the **denied** path as well as the happy path.
- **TEST-3 MUST** Coverage floor on platform-core modules (≥ 80% lines) and on **changed lines** in a PR
  (≥ 70%); no repo-wide vanity target. Coverage counts behaviour, not snapshot-only render tests.
- **TEST-4 MUST** E2E/walkthrough runs **authenticated** (asserts it is not on `/login`), in **both
  themes**, and fails on console errors, uncaught exceptions and failed network requests.
- **TEST-5 MUST** Flaky tests are quarantined with an owner and a date, not retried until green.
- **TEST-6 MUST** **Walkthrough test per screen** — one spec per routable screen that performs, in order:
  open it as a fresh user → assert loading, **empty**, error and data states render → configure / create
  an object through the UI → see it populate → drill into it → edit and delete it → export → open help
  (HELP-1) → verify an audit event with actor + role was written (LOG-5) → screenshot in light and dark
  (THEME-9) → repeat as a lower role and assert the denied paths. The same specs regenerate help
  screenshots (HELP-10) and are the live evidence for `APP_REVIEW.md`.
- **TEST-7 MUST** **Feature → test map is enforced:** every feature key in the nav/router inventory has
  tests tagged with it (`@feature:<key>` in the test name or tag) covering unit, e2e and walkthrough; a CI
  step lists features missing any kind and fails. A new route without tagged tests cannot merge.
- **TEST-8 MUST** Bugs get a regression test that fails before the fix and passes after, in the same PR.
- **TEST-9 SHOULD** Contract tests between client and API are generated from the API-1 schema; load
  smoke (`k6`) at expected peak for APIs with a PERF-1 budget; visual-regression goldens for the shared
  components.

---

## 6E · Operations & delivery

- **OPS-1 MUST** `/healthz` (liveness) and `/readyz` (dependencies) endpoints; graceful shutdown that
  drains in-flight requests and jobs.
- **OPS-2 MUST** CI/CD: gates (§7.1) → preview/staging deploy → migrations → prod, with a one-command
  **rollback** that has been exercised. Deploys are tagged with the git SHA logged as `version`.
- **OPS-3 MUST** Backups with written **RPO/RTO**; a restore is actually performed and verified at least
  quarterly (a backup never restored is a hope).
- **OPS-4 MUST** Environments are config-identical except for values; secrets differ per environment;
  prod data never copied to dev unmasked.
- **OPS-5 MUST** A `docs/RUNBOOK.md`: how to deploy, roll back, rotate each secret, restore, and
  respond to each alert in LOG-9.
- **OPS-6 SHOULD** Cost guardrails: budget alerts on cloud/LLM/SMS spend; per-tenant usage metered.
- **OPS-7 SHOULD** Uptime monitoring (e.g. Uptime Kuma) on every public endpoint and TLS expiry.

## 6F · Repo hygiene

- **REPO-1 MUST** `README` (run, test, deploy in < 10 lines each), `CLAUDE.md` referencing this
  standard, `CHANGELOG`, ADRs in `docs/adr/` for decisions that constrain future work.
- **REPO-2 MUST** Protected `main`: PR required, gates green, no force-push; `CODEOWNERS` for platform
  core, tokens, migrations, CI.
- **REPO-3 SHOULD** Conventional commits; PR template with "standard rules touched / exceptions added".
- **REPO-4 MUST** Dependency licences checked (no AGPL/unknown in shipped code without a decision).

---

## 6G · In-app help & documentation — every screen, every field

Help is a product feature with a shared module (CORE-16), not a wiki someone updates later. The
customer should be able to understand and use any screen **without leaving it**.

**Per screen (MUST)** — one registry entry keyed by route, opened from a consistent `?` affordance in
the page chrome (CORE-11), containing:
`title · what this screen is for (the decision it helps make) · how to (numbered steps for the main
tasks) · fields & columns (meaning, units, where the data comes from, how fresh) · roles (who can do
what here) · tips · troubleshooting (common errors and fixes) · link to the full doc page`.

- **HELP-1 MUST** **Screen help** for every routable screen/tab, in the registry, rendered by the shared
  help panel/sheet. Content lives in the registry (Markdown/JSON), not in widget code.
- **HELP-2 MUST** **Field-level inline help** wherever a field, column, metric or setting isn't
  self-explanatory: helper text under the input, an `ⓘ` tooltip/popover for columns and metrics, units
  and allowed ranges stated, examples for formats. Keyed by field id in the same registry.
- **HELP-3 MUST** **Errors teach the fix.** Validation and error messages say what's wrong and how to fix
  it, map from CORE-7 error codes to registry text, show `request_id`, and link to the relevant help.
- **HELP-4 MUST** **Empty states guide** — say why it's empty and offer the next action (configure,
  import, create, run the job) — copy comes from the registry.
- **HELP-5 SHOULD** **First-run onboarding**: a short tour or checklist per major area; tour anchors
  reference stable widget/test ids and a test asserts every anchor resolves.
- **HELP-6 MUST** **Living docs** in `docs/user/<feature>.md` (one page per feature, docs-as-code,
  reviewed in the same PR as the feature); every registry entry links to its page; served in-app or on
  the docs site. Developer docs (`docs/adr/`, `RUNBOOK.md`, API schema) are separate from user docs.
- **HELP-7 MUST** **Help is tested and kept current:**
  (a) a test asserts every route resolves to a registry entry and every entry's doc link resolves;
  (b) a test or lint asserts every form field/column id used in screens has a field-help entry or is
  explicitly marked self-explanatory; (c) the PR template asks "help/docs updated?"; a UI change that
  alters labels, fields or steps without a help change is a review finding.
- **HELP-8 SHOULD** Help is searchable from anywhere (command palette / help search), externalized for
  i18n with the rest of the strings, and accessible (keyboard, screen reader, both themes).
- **HELP-9 SHOULD** Help usage is observable: `help.open` / `help.search` events (LOG-1) with no PII; a
  search with no result is a docs backlog item.
- **HELP-10 SHOULD** Screenshots in docs are regenerated by the e2e suite (Playwright / integration
  tests), so they never show a previous version of the UI.

---

## 7 · Enforcement — make the standard mechanical

### 7.1 Gates (CI, blocking on every PR)

| Gate | Go | TS / JS | Python | Dart / Flutter | Swift |
|---|---|---|---|---|---|
| Format + lint | `gofmt`, `golangci-lint` (incl. `gosec`, `forbidigo`) | `eslint` (+ `eslint-plugin-security`, `no-restricted-imports/syntax`), `prettier` | `ruff` (incl. `S` bandit rules, `TID251` banned-api) | `dart format`, `flutter analyze` (strict) | `swiftlint` |
| Types | `go vet` | `tsc --noEmit` (strict) | `mypy`/`pyright` | analyzer | compiler |
| Tests | `go test -race ./...` | `vitest`/`jest` + Playwright | `pytest` | `flutter test` + `integration_test` | XCTest |
| Dep CVEs | `govulncheck` | `osv-scanner` / `npm audit --audit-level=high` | `pip-audit` | `osv-scanner` | `osv-scanner` |
| Complexity + architecture (CLEAN-2/3) | `gocyclo`/`gocognit` (golangci), `depguard` | ESLint `complexity`, `max-lines*`, `max-params`, `sonarjs`; `dependency-cruiser`; `knip`; `size-limit` | `ruff` `C901`/`PLR09xx`; `import-linter`; `vulture` | `very_good_analysis` lints; `custom_lint` | `swiftlint` `cyclomatic_complexity`, `function_body_length` |
| **All stacks** | `gitleaks` (secrets) · `semgrep --config p/default p/owasp-top-ten` + repo custom rules (SAST) · `trivy fs/config` · `zizmor` (CI) · client-bundle secret allow-list check · Lighthouse CI / bundle-size budget (web) |

### 7.2 Banned-API rules (one per CORE row) — shipped in the kit
§1's "banned elsewhere" column is encoded as Semgrep rules in `engineering-standard/semgrep/`
(Dart, TS/JS/CSS, Go, Python, Swift), vendored into each repo at `.semgrep/standard/` by `adopt.sh` and
run by `tools/standard/check.sh`. Each rule is named `std.<lang>.<rule>`, cites the standard rule it
enforces, and has must-fail / must-pass tests. Coverage: raw colours, palette classes, style literals,
direct icon imports, `print`/`console`, env reads outside config, raw HTTP clients, string-built SQL,
`eval`, TLS bypass, tokens in insecure storage, secrets in log calls, empty catches.

- **ENF-1 MUST** New repos adopt the kit at creation; existing repos adopt with `--baseline` so only
  **new** violations fail, then burn the baseline down.
- **ENF-2 MUST** A single line may be suppressed only with `nosemgrep: <rule-id> -- <reason>`; anything
  broader goes in `docs/STANDARD_EXCEPTIONS.md` with an expiry. `.semgrepignore` lists only generated,
  vendored or third-party code.
- **ENF-3 SHOULD** Stack-native linters mirror the most common rules for in-editor feedback
  (`forbidigo`, ESLint `no-restricted-imports`, `ruff` banned-api, `custom_lint`), but Semgrep is the
  CI source of truth.

### 7.3 Local loop
- `pre-commit` (or `lefthook`) runs format, `gitleaks protect --staged`, and fast lint.
- Claude Code hook (via `/update-config`; snippet in the kit README): `PostToolUse` on `Edit|Write`
  runs the standard's Semgrep rules on the touched file and exits 2 on a violation, so Claude fixes it
  in the same turn.
- **Agent rule (put in every repo's `CLAUDE.md`):** when Claude adds or changes a feature it also writes
  or updates that feature's unit, integration, e2e and walkthrough tests (TEST-0), runs them and
  `tools/standard/check.sh`, and reports the real output — never "should pass".

### 7.4 Claude Code plugins & skills that apply this standard

| When | Use |
|---|---|
| Before writing a feature | `feature-dev:feature-dev` (explorer → architect → reviewer) — point the architect at §1 so it reuses the core |
| Before opening a PR | `/security-review` (pending diff) · `/code-review high` · `/simplify` (reuse + efficiency) |
| Large branch / pre-release | `/code-review ultra` (user-triggered cloud multi-agent review) |
| Supabase / Postgres | `supabase:supabase-postgres-best-practices` (RLS, indexes, SECURITY DEFINER) |
| Azure apps | `azure:appinsights-instrumentation` (OTel → App Insights), `azure:azure-compliance` |
| Vercel apps | `vercel:verification`, `vercel:vercel-firewall` |
| Keeping repos aligned | `claude-md-management:claude-md-improver` — checks each repo's `CLAUDE.md` references this standard |
| Live verification | Playwright plugin (`mcp__plugin_playwright_*`) — drive both themes, assert `request_id` on errors |

---

## 8 · Definition of "meets the standard"

A repo meets the standard when:
- [ ] §1 platform-core table is filled in and every CORE row exists.
- [ ] Kit adopted (`tools/standard/VERSION` current); `tools/standard/check.sh` runs in CI and is
      **blocking**; any `.semgrep/baseline.json` is shrinking release over release.
- [ ] §7.1 gates run in CI and are **blocking**.
- [ ] Every nav feature has tagged unit + e2e + walkthrough tests (TEST-0, TEST-7).
- [ ] Websites: deploy runs `check-build.mjs` before upload and `check-site.mjs` after, with zero
      ERRORs on every hostname; a weekly scheduled `check-site.mjs` run alerts on regressions (§2A).
- [ ] `docs/THREAT_MODEL.md`, `docs/OBSERVABILITY.md` (producer × sink table), `docs/RUNBOOK.md` and
      `docs/user/` (one page per feature) exist and are current; help-registry tests (HELP-7) pass.
- [ ] One token source and one icon registry (§6A); banned-colour/icon lint is at **error**.
- [ ] Every deviation is listed in `docs/STANDARD_EXCEPTIONS.md` with rule ID, reason, owner, expiry.
- [ ] `APP_REVIEW.md` has been run and has **zero open P0** findings.

### Severity (shared with `APP_REVIEW.md`)
**P0** blocks release: exploitable vuln, auth bypass/IDOR, secret leak, data loss, fabricated success,
mutation without audit, inert security control. **P1** customer cannot get the feature's value, or a
MUST rule is broken without mitigation. **P2** consistency/ergonomics, SHOULD rules. **P3** polish.
(Legacy mapping: Critical→P0 · High→P1 · Medium→P2 · Low→P3.)

# App Review — Client-Acceptance, Security & Release Harness (v2)

> One harness for reviewing **any** application under `~/code`: is it **shippable to a paying
> customer**, is it **secure**, and does it **meet [`ENGINEERING_STANDARD.md`](ENGINEERING_STANDARD.md)**?
> Stack-agnostic: Phase −1 auto-detects the stack, Phase 0 writes the one product-specific context
> file, and everything else transfers unchanged.
>
> **To run:** say *"Run ~/code/APP_REVIEW.md against `<repo>` (profile: quick | standard | full)."*
> The agent runs Phase −1 → 0 → §8 orchestration → §10 deliverables. Placeholders look like `{{THIS}}`.
>
> Supersedes: `e2e-review-generic-prompt.md`, `E2E-Review-Master-Prompt.md`, `SecureApplication.md`
> (audit procedure), `QA_PLAYBOOK.md` (release checklist → §9).

**Reading order:** Prime Directive → §3 archetypes → §4 Day-1 walkthrough → §5 rubric → your lens card
in §6 → §7 schema. Phase −1, Phase 0 and §2 are reference.

---

## ⚠️ PRIME DIRECTIVE

**You are performing a client-acceptance review of a product about to be delivered — not a code
audit.** The question is never *"did this pass the checks?"* It is:

> **"If I handed this to a paying customer tomorrow, could they do their job with it — unaided and safely?"**

Four rules override everything else:

1. **Inverted burden of proof. The default verdict is `INCOMPLETE`, not `PASS`.** Emit `PASS` only with
   **positive evidence** the user can complete the task end to end. *"I found nothing wrong" describes
   your search, not the product* — emit `INCOMPLETE` and name what you could not confirm.
2. **Judge the feature, not the endpoint.** "200 with rows" is the floor. The bar is *the customer gets
   the value the feature promises.*
3. **Evidence over assertion.** Every finding cites `file:line` (or `METHOD /path → status`, or scan
   output) and was opened and confirmed. Ungroundable claims are discarded.
4. **Say the uncomfortable thing.** `NOT-SHIPPABLE`, `retire`, `No-Go` — plainly. A polite review that
   lets a broken or insecure feature reach the client is the worst possible outcome.

**Read-only by default.** No code changes unless the user asked for fixes. Never run a deploy step while
the security gate (§9.1) is red. Never fire destructive actions (§8.4).

**Why.** Ordinary lenses measure code against itself — tests green, route 200, types check. All of that
can be true while the customer has nowhere to enter their data, the screen lists rows instead of
answering the question, or the reported "success" never happened. A run of this harness on one such
product found **1,002 findings, 50 P0, and 0 of 61 features shippable** on a fully green test suite.

---

## Phase −1 · Auto-detect the stack (always run first)

Inspect `{{REPO_PATH}}` with cheap `ls`/`grep`/glob; take the first match per row; anything undetectable
→ `n/a` (dependent lens/cell is dropped and the report says so). Detection is best-effort — record
ambiguities in `context.md` so reviewers don't thrash.

| Signal | Stack | Nav/screen source | Tests | Gate command |
|---|---|---|---|---|
| `pubspec.yaml` | Flutter/Dart | `GoRouter`/route table, `*_screen.dart` | `test/`, `integration_test/` | `flutter analyze && flutter test` |
| `next.config.*` | Next.js | `app/**/page.tsx` or nav const | `*.test.ts(x)`, `e2e/*.spec.ts` | `tsc --noEmit && npm test && npm run lint` |
| `package.json` + react, no Next | React/Vite SPA | `routes.tsx` | `*.test.ts(x)`, `e2e/`/`cypress/` | `tsc --noEmit && npm test` |
| `go.mod` | Go | mux/router registration | `*_test.go` | `go build ./... && go test -race ./...` |
| `pyproject.toml`/`requirements.txt` | Python | `urls.py` / `@app.route` / `APIRouter` | `tests/`, `test_*.py` | `ruff check && pytest` |
| `Package.swift`/`*.xcodeproj` | Swift | SwiftUI views / route enum | `*Tests/` | `xcodebuild test` |

| Backend signal | Backend | API source | Store |
|---|---|---|---|
| `supabase/` | Supabase | `supabase/functions/*` + RPCs | Postgres + RLS + Realtime |
| `prisma/schema.prisma` | Prisma/Node | `app/api/**/route.ts` | Postgres/MySQL |
| `firebase.json` | Firebase | Cloud Functions | Firestore/RTDB |
| `drizzle/`, `netlify.toml`, `vercel.json` | Serverless + SQL | route handlers / edge fns | Neon/Netlify/Vercel PG |
| `net/http`/chi/gin in Go | Go service | router file | grep the store |

**Standard kit evidence (run once, cheap, reused by L6/L9/L10/L12):** if `tools/standard/check.sh`
exists run it; otherwise run the kit directly — `pipx run semgrep --metrics=off --config
~/code/engineering-standard/semgrep --json -q {{REPO_PATH}}` and, if `design/tokens/` exists,
`node ~/code/engineering-standard/design-tokens/scripts/validate.mjs --design {{REPO_PATH}}/design`.
Save counts per rule to `{{QA_DIR}}/standard-scan.json`. No `design/tokens/` ⇒ THEME-1 finding.

**Pattern signals** (grep; blank ⇒ cell flagged as *missing*, which is itself a finding against the standard):
platform-core modules CORE-1…16 from the standard (config, secrets, logger, `record()`/audit, authz,
HTTP client, errors, store, validation, jobs, UI grid, fetch hook, theme/tokens, notifications, flags, help registry) · help registry · docs path · auth
model + admin-only routes · destructive ops (delete/rotate/apply/disable) · segment dimension
(tenant/provider/type) · declared data sources · seed/demo data and its gate.

## Phase 0 · Shared context (once; skip if `{{QA_DIR}}/context.md` exists and is current)

Write `{{QA_DIR}}/context.md` (default `qa-out/`) so N reviewers never re-derive it. **Reviewers are
forbidden from re-deriving anything in it.** Use `feature-dev:code-explorer` for the lineage mapping.

```
Product:        {{NAME}} — {{what it does, for whom}}
Repo / commit:  {{PATH}} @ {{BRANCH}} @ {{SHA}}
Stack:          {{from Phase −1, with counts: N routes · N screens · stores · workers}}
Roles:          {{roles + privilege boundaries; how to authenticate as each for live checks}}
Sensitive data: {{PII / payments / credentials / health …}}   Compliance: {{GDPR/HIPAA/SOC2/none}}
Deploy target:  {{Vercel / Azure / Hostinger / self-hosted (a self-hosted VM) …}}
Persistence:    {{the rule — e.g. "Postgres only; in-memory state is a defect"}}
```

Plus: **feature inventory** (from nav/router, not the filesystem) grouped into menu-groups · the
**shared-seams table** (the standard's §1 "This repo" column, with how many call sites actually use
each) · **seed-data contract** · **config asymmetry** (backend reads N env vars; UI exposes M config
screens) · **test surface** (unit/integration/e2e counts; what is untested) · **known non-defects —
do NOT re-report** (deliberate decisions, already-fixed-pending-release, entries in
`docs/STANDARD_EXCEPTIONS.md`) · prior results to reuse (`audit-result.json`, earlier reports).

For live checks also write `{{QA_DIR}}/walk-context.md`: per-role login steps, R/M/D action classes,
destructive-op list, and the audit invariant (§8.4).

---

## 2 · Acceptance questions

| # | Question | Lens | Standard |
|---|---|---|---|
| 1 | **No ephemeral data** — everything created/changed persists and survives restart; writes are transactional | L2 | COR-4 |
| 2 | **Functional with data & matches design** — features work fully, not merely render | L1 | COR-5 |
| 3 | **All data sources reflected** — every declared source/subsystem feeds the screens that aggregate it | L8, L2 | LOG-6 |
| 4 | **Every tunable parameter and user-authored object has a UI** to view/create/edit it | L3 | COR-6, UX-4 |
| 5 | **Drill-down** — row/tile → detail for that item | L4 | UX-3 |
| 6 | **Filters & segments** — filters filter; All / per-segment views with correct counts | L4 | — |
| 7 | **Export & reports** — lists export; screens that warrant a standing report have one | L4 | UX-3 |
| 8 | **Real data, honestly labelled** — no ungated demo data; no fabricated success | L5 | COR-1, COR-2 |
| 9 | **Insight** — the screen answers the decision the user opened it for | L4 | — |
| 10 | **Tests** — every feature has unit, integration (incl. denied path), e2e journey and walkthrough tests, tagged `@feature:<key>`, passing in CI | L12 | TEST-0, 6, 7 |
| 11 | **Help & docs** — screen help, field-level inline help, teaching errors/empty states, living-docs page, all current | L12 | §6G HELP-1–7 |
| 12 | **One product** — consistent chrome, four states, one token source + icon registry used everywhere, same meaning = same colour/icon, legible in light **and** dark, accessible | L10 | UX-1,2,5 · §6A |
| 13 | **Shared code** — platform core used; copy-paste that should be promoted | L9 | §1 |
| 14 | **Unified logging & audit** — schema, correlation, redaction, actor+role, producer coverage | L8 | §5 |
| 15 | **Secure** — authz on every path, no IDOR, no secret leaks, scans clean, threat model current | L6, L7 | §2 |
| 16 | **Optimized & concurrent-safe** — budgets met, bounded, paginated, timeouts, no clobbering | L11 | §3 |
| 17 | **Gaps & improvements** — anything that would make the product materially better | all | — |

---

## 3 · Failure archetypes ⭐ the core of this review

Each is a way a product can be **fully green and fully unusable or unsafe**. All are invisible from
inside the code.

| | Archetype | One-line test | Severity |
|---|---|---|---|
| **A** | Orphaned input | Can the user point this at *their own* data from the UI? | P1 |
| **B** | No insight | Does it answer the question, or just list rows? | P1 |
| **C** | Missing producers | Does every subsystem actually feed this aggregation surface? | P0/P1 |
| **D** | Vestigial | Does this earn its slot in the navigation? | P2 + verdict |
| **E** | No entry path | Can I create/edit/delete the objects this screen manages? | P1 |
| **F** | Design drift | Does it look like the same product as the last screen? | P1 (UX-2, CORE-11) |
| **G** | Theme break | Legible in both light and dark? | P1 + NOT-SHIPPABLE |
| **H** | Fabricated success ⭐ | Does it report a success it didn't perform? | **P0** |
| **I** | Inert code ⭐ | Does anything actually *call* this? | P0/P1 |
| **J** | Bypassed core ⭐ | Does this go around a platform-core module (authz, logger, HTTP, config, secrets)? | P0 if it skips authz, audit, redaction, secrets or HTTP/SSRF; else P1 (SHR-2) |

**A · Orphaned input.** A scanner that reads targets only from an env var: engine works, screen is
beautiful, customer can never point it at their hosts. *Test:* trace backwards screen → API → store →
producer → its input; the first hop the operator can't reach from the UI is the finding. **A seed
dataset usually exists to paper over an orphaned input — name the input it stands in for.**

**B · No insight.** Nobody opens a log table to read rows; they want *what's broken, how bad, who owns
it*. *Test:* complete "the user opened this screen to decide ___", then check for ranking, grouping,
thresholds, user rules, trend, and an **action from the row**. If the answer needs a spreadsheet, fail.

**C · Missing producers.** A well-built activity/audit/metrics surface fed by 9 of 63 subsystems looks
complete, so users conclude nothing else happened. *Test:* work producer-side; return a
**producer × sink matrix** with misses named. P0 when the surface is used for security/compliance.

**D · Vestigial.** Thin slices of neighbours, unusable screens, refactor leftovers. Every feature gets
`keep | merge into X | move to Y | retire`. No abstentions.

**E · No entry path.** Read-only over operator-authored objects (rules, budgets, targets). *Test — the
no-mutation detector:* list the HTTP verbs each screen's UI can issue; GET-only over user-authored
objects is a finding. Free text where a picker bound to real inventory belongs is a finding too.

**F · Design drift.** Hand-rolled tables beside the shared grid (losing filter/export/paging), missing
empty states, five button styles. Each instance names the canonical primitive.

**G · Theme break.** Hardcoded light CSS, raw colours. *Token invariant:* no raw colour literals; every
3rd-party stylesheet has a dark bridge. **A single-mode check is `INCOMPLETE`.** Verify the e2e suite is
actually authenticated — a suite redirected to `/login` "passes" every page without rendering any.

**H · Fabricated success.** A "Test restore" button that stamped `healthy` without restoring; a
simulator driver that "verified" a change against a production host it never touched; a mock executor
as silent fallback; demo costs summed into real spend. *Test:* for every success path, *what did this
actually DO?* Follow the write to the real system. Honest "can't do this" is correct; plausible
invention is P0.

**I · Inert code.** A retention sweep whose only caller was an unregistered route; a persistence layer
whose wiring was never invoked at boot; a working API no screen calls. *Test:* trace to something that
runs — route registered, worker started, endpoint fetched. Tests prove code works *when called*.

**J · Bypassed core.** An authz check reimplemented inline (and wrong), a `console.log` that leaks a
token, a raw `fetch` with no timeout or SSRF guard, an `os.Getenv` the config UI doesn't know about.
*Test:* grep for the standard's banned APIs (§7.2) outside their core module; each hit names the core
module it should use.

---

## 4 · Day-1 walkthrough (run on EVERY feature)

> *"I'm a new customer. I just logged in. I'm opening this screen for the first time. Can I…"*

| # | Step | If NO → |
|---|---|---|
| 1 | **Understand** what it's for, from the screen itself? | help |
| 2 | **Configure** it — point it at *my* data, from the UI? | **A** · P1 |
| 3 | **Populate** it — trigger/schedule the job, see when it last ran? | populate |
| 4 | **Trust** it — real data or seed, honestly labelled? | **A** · P1 / **H** · P0 |
| 5 | **Understand the answer** — ranked/grouped, not a wall of rows? | **B** · P1 |
| 6 | **Drill in** to the row that worries me? | drill |
| 7 | **Act** — remediate/assign/suppress/approve from here? | **B** |
| 8 | **Author** — create/edit/delete this screen's objects? | **E** · P1 |
| 9 | **Prove** — see my action in the audit trail with **who** and **what role**? | audit |
| 10 | **Report** — export or get a standing report? | export |
| 11 | **Recognize** it as the same product? | **F** |
| 12 | **Read it in my theme**, with a keyboard/screen reader? | **G** · P1 |
| 13 | **Be safe** — another user/tenant can't see or change my data here? | **sec** · P0 |

**The first NO is the finding.** A feature blocked at step 2 is not graded on 5–12 — record
`blocked_at: 2` and move on. **`blocked_at ≤ 4` ⇒ `NOT-SHIPPABLE`.** A step-12 or step-13 failure ⇒
`NOT-SHIPPABLE` regardless of the rest.

---

## 5 · Per-feature rubric

One finding **per failing cell**, not per screen. All cells passing → a single `PASS`, only with
positive evidence.

| Cell | Passing bar | Arch / rule |
|---|---|---|
| source | User points it at their own data from the UI | A |
| insight | Answers the decision; ranking/grouping/rules/action from row | B |
| entry | CRUD for user-authored objects; pickers bound to real inventory | E · UX-4 |
| config | Every needed value settable in UI, or documented deploy-only | COR-6 |
| persist | Real datastore; survives restart; transactional | COR-4 |
| populate | Registered job fills it; freshness shown | CORE-10 |
| real | Not demo/seed/hardcoded; if a seed exists, name the missing input | A · COR-2 |
| honest ⭐ | Every reported success happened; refuses loudly otherwise | H · COR-1 |
| live ⭐ | Backing code reachable — route registered, worker started, endpoint called | I · COR-5 |
| core ⭐ | Uses platform-core modules; no banned-API bypass | J · §1 |
| authz | Server-side authz + ownership on every read/mutation; boundary test 403s | SEC-6,7,8 |
| data-safety | No secret/PII in logs, URLs, responses, bundles | SEC-11 · LOG-4 |
| audit | Every mutation → `record()` with actor **and** role, outcome, request_id | LOG-1,5 |
| perf | Paginated, indexed, timeouts, within budget | PERF-1–4 |
| drill / export | Row → detail; list exports | UX-3 |
| help | Screen help entry + field help for non-obvious fields + errors/empty states that teach + doc page; all match the screen now | HELP-1–7 |
| tests | Unit + integration (incl. denied) + e2e journey + walkthrough exist for this feature, tagged, and pass; walkthrough covers all four states and both themes | TEST-0, 4, 6, 7 |
| theme / darkmode / a11y | Shared chrome, 4 states, semantic tokens + icon registry only, consistent meaning→colour/icon; verified in **both** modes; WCAG AA | UX-1,2,5 · THEME-1–9 |
| *verdict* viability | `keep` · `merge into X` · `move to Y` · `retire` — every feature | D |
| *verdict* ship | `SHIP` · `SHIP-WITH-CAVEAT` · `NOT-SHIPPABLE` — name the blocker | Prime Directive |

**Calibration.** honest fail = **P0** always · authz/IDOR/secret leak = **P0** · live or audit fail on a
security/compliance path = **P0** · source / insight (analysis screen) / entry / seed-covering-a-source
= **P1** · darkmode break = **P1 + NOT-SHIPPABLE** · core bypass = P0 if it skips authz, audit, redaction, secrets or HTTP/SSRF,
else P1 (SHR-2).

---

## 6 · Lens roster (one agent per lens)

**Shared preamble — prepend to every card:**

> You are one reviewer in a client-acceptance review of {{PRODUCT}} ({{PATH}} @ {{SHA}}). Obey the
> Prime Directive: default `INCOMPLETE`; never `PASS` without positive evidence; judge the feature,
> not the endpoint; say the uncomfortable thing. Read §3 and §4 first and run the Day-1 walkthrough on
> every feature in scope, recording `blocked_at`. Read `{{QA_DIR}}/context.md` — do NOT re-derive it
> or re-report known non-defects. Cite the ENGINEERING_STANDARD rule ID for every standard violation.
> Read **excerpts** (grep + targeted reads), never whole files. **Write nothing** — no repo or scratch
> files; return ONLY findings in the §7 schema, snippets ≤ 8 lines. Scope: {{SCOPE}}.

| Lens | Qs | Scope | Mission |
|---|---|---|---|
| **L1 · Functional & Lineage** | 2, 17 | group | **Owns A.** Every route renders with data; trace lineage backwards for every feature; flag every hop the user can't reach; matches nav intent/design. |
| **L2 · Data & Persistence** | 1, 3 | group | Survives restart; caches that drop writes; fire-and-forget writes; UI-only state that never POSTs; non-atomic multi-step writes; orphaned rows; every declared source reflected. |
| **L3 · Config & Entry** | 4 | app | **Owns E.** Classify every env var (user-tunable vs deploy-secret); each tunable without UI gets a `field_spec`. Run the no-mutation detector. *Usually the highest yield — be exhaustive.* |
| **L4 · Product Value & IA** | 5,6,7,9 | group | **Owns B + D.** "The user opened this to decide ___" per feature; viability verdict for every feature; drill-down, filters/segments, export, standing reports. Think like the product owner on a Monday morning. |
| **L5 · Honesty Auditor** ⭐⭐ | 8 | app | **Owns H + I.** For every success path: what did it ACTUALLY do? Follow the write to the real system. For every subsystem: does anything call it? Seeds and their missing inputs. *Finds the P0s nobody else can see.* |
| **L6 · AppSec & Supply Chain** | 15 | app | **Runs the §9.1 scanners** and checks VULN-1…7 (SECURITY.md, fix-time targets, Scorecard) (incl. `check-site.mjs` on the live URLs and `check-build.mjs` on the publish dir for anything web-facing — standard §2A) and triages output; SAST review for injection/XSS/SSRF/path traversal/deserialization/weak crypto; headers & CORS; IaC; CI hardening; LLM features vs SEC-19 and AI-1…9; agent configuration vs §2C (AGT-1…10: `.claude/settings.json` deny rules, subagent `tools:`, `.mcp.json` pins, headless workflows); supply chain vs §2E (cooldowns, trusted publishing, attestation verified at deploy, EOL). Paste real scan output. |
| **L7 · Identity, Authz & Privacy** | 15 | app | **RBAC boundary test** (every admin-only route 403s for lower roles); IDOR (user A vs B, tenant X vs Y); identity derived server-side; RLS per operation; session/cookie/CSRF; PII inventory, retention, deletion; threat model current (SEC-20). |
| **L8 · Observability & Sinks** | 3, 14 | app | **Owns C.** Producer × sink matrix (log, audit, activity, metrics) with misses named. Schema conformance to LOG-1 (OTel attribute names); SLOs + burn-rate alerts (REL-1); redaction (LOG-4); actor **and** role; request_id end-to-end; silent catches; alerting exists. |
| **L9 · Architecture & Reuse** | 13 | app | **Owns J.** Every CORE module exists and is the only path; triage `standard-scan.json` (`std.*` rule hits = bypasses, grouped by CORE module); copy-paste to promote (name the unit + call sites); dead code and unused deps. Kit adopted and baseline shrinking? |
| **L10 · Design System, Theme & A11y** | 12 | app | **Owns F + G — do G first.** Both modes on every screen; one token source + icon registry (count raw colours / direct icon imports outside them); same meaning → same token/icon on every screen; contrast; four states; WCAG 2.2 AA; recommend the durable fix (lint rule + both-modes e2e sweep), not one-off patches. |
| **L11 · Performance & Concurrency** | 16 | app | Budgets (PERF-1) measured; N+1, missing indexes, unpaginated lists, missing timeouts; bounded concurrency; locks/upserts/idempotency/leases; multi-replica safety; no cross-tenant cache bleed. |
| **L12 · Tests & Help** | 10, 11 | app | Feature → test map across the four kinds (unit · integration incl. denied · e2e journey · walkthrough, TEST-0/6/7); name every feature missing a kind and the exact spec to write, highest-risk mutating/authz first; run the suite and paste results; e2e actually renders (authenticated, both themes). Help per §6G: every route has a registry entry, non-obvious fields/columns have inline help, errors and empty states teach the next step, every feature has a `docs/user/` page, and help matches the screen *now* (watch for help that predates a refactor). |

**Profiles** (keeps agent count proportional to the ask):
- **quick** (≈5 agents, pre-PR / small app) — L5, L6, L7, L8, L9 app-wide.
- **standard** (12 agents, pre-release) — all lenses app-wide.
- **full** (12 + group fan-out, client acceptance) — L1, L2, L4 × each menu-group; the rest app-wide.

---

## 7 · Finding schema (return ONLY this)

```json
{
  "id": "L7-003", "q": 15, "lens": "L7",
  "screen": "{{feature-key}}", "route": "/{{route}}", "api": "GET /api/{{...}}",
  "cell": "source|insight|entry|config|persist|populate|real|honest|live|core|authz|data-safety|audit|perf|drill|export|help|tests|theme|darkmode|a11y|viability|ship",
  "archetype": "A|B|C|D|E|F|G|H|I|J|none",
  "standard_ref": "SEC-7",
  "severity": "P0|P1|P2|P3|PASS|INCOMPLETE",
  "mode": "static|live|scan",
  "role": "admin|member|anon|na",
  "evidence": "file:line, ≤8-line snippet, 'METHOD /path → status', or scanner rule id + location",
  "observed": "what is", "expected": "what should be",
  "blocked_at": 2,
  "ship": "SHIP|SHIP-WITH-CAVEAT|NOT-SHIPPABLE|na",
  "viability": "keep|merge into X|move to Y|retire",
  "decision": "the user opened this screen to decide ___",
  "lineage_gap": "the hop the user cannot reach",
  "field_spec": "label · type · default · validation · role · screen it belongs on",
  "canonical": "the shared primitive / CORE module that should have been used",
  "unconfirmed": "REQUIRED when severity=INCOMPLETE",
  "fix": "concrete, names files", "effort": "S|M|L",
  "confidence": "high|med|low"
}
```

Required: `id, q, lens, screen, cell, severity, evidence, confidence` (+ `unconfirmed` when INCOMPLETE).
Severity per the standard §8: **P0** blocks release · **P1** customer can't get the value / MUST broken ·
**P2** consistency · **P3** polish · **PASS** positive evidence · **INCOMPLETE** honest default.
Effort: **S** ≤ ½ day · **M** ≤ 2 days · **L** > 2 days / needs design.

---

## 8 · Orchestration

**Rules.** One lens per agent (two lenses blur into the average of both). Reviewers return data; one
synthesizer writes all files. Findings are *claims* until verified.

### 8.1 Tools to use

| Step | Tool |
|---|---|
| Phase 0 lineage map | `feature-dev:code-explorer` agent |
| Standard evidence | `tools/standard/check.sh` / kit Semgrep rules + `validate.mjs` (Phase −1) |
| Fan-out + verify + synthesize | **Workflow** tool with the script below (requires the user to opt in to multi-agent orchestration); otherwise parallel `Agent` calls in one message |
| Live walkthrough, both themes, RBAC as each role | Playwright plugin (`browser_navigate`, `browser_snapshot`, `browser_emulate_media` for dark mode, `browser_network_requests`) |
| Diff-level security on a branch | `/security-review` |
| Independent second opinion | `/code-review high` (local) or `/code-review ultra` (user-triggered cloud review) |
| Supabase apps (L7) | `supabase:supabase-postgres-best-practices` |
| Azure / Vercel deploys (L6) | `azure:azure-compliance` (azqr) · `vercel:vercel-firewall` |
| After fixes | `/simplify` on the changed code, then re-run the gate |

### 8.2 Workflow script (stack-agnostic; fill `CONFIG` from Phase −1/0)

```javascript
export const meta = {
  name: 'app-review',
  description: 'Client-acceptance + security review: lens fan-out, adversarial verify, synthesis',
  phases: [{ title: 'Review' }, { title: 'Verify' }, { title: 'Synthesize' }],
}

const CONFIG = {
  appName: '{{APP_NAME}}', repoPath: '{{REPO_PATH}}', qaDir: '{{QA_DIR}}',
  profile: 'standard',                         // quick | standard | full
  groups: ['{{Group A}}', '{{Group B}}'],      // menu-groups from context.md (used by 'full')
}

const LENSES = [
  { key:'L1',  qs:'2,17',    group:true,  brief:'Functional & lineage. Owns archetype A. Trace screen→API→store→producer→input; flag unreachable hops.' },
  { key:'L2',  qs:'1,3',     group:true,  brief:'Data & persistence: survives restart, transactional writes, no dropped/UI-only writes, all sources reflected.' },
  { key:'L3',  qs:'4',       group:false, brief:'Config & entry. Owns E. Classify every env var; field_spec per tunable without UI; no-mutation detector.' },
  { key:'L4',  qs:'5,6,7,9', group:true,  brief:'Product value & IA. Owns B+D. Decision sentence + viability per feature; drill, filters/segments, export.' },
  { key:'L5',  qs:'8',       group:false, brief:'Honesty auditor. Owns H+I. What did each success path ACTUALLY do? Is each subsystem actually called?' },
  { key:'L6',  qs:'15',      group:false, brief:'AppSec & supply chain. Run gitleaks, semgrep, osv-scanner/govulncheck, trivy fs+config, zizmor; triage; SAST review; headers; LLM (SEC-19).' },
  { key:'L7',  qs:'15',      group:false, brief:'Identity, authz & privacy. RBAC boundary test, IDOR A-vs-B, server-derived identity, RLS per op, sessions/CSRF, PII retention/deletion, threat model.' },
  { key:'L8',  qs:'3,14',    group:false, brief:'Observability. Owns C. Producer×sink matrix; LOG-1 schema; redaction; actor AND role; request_id; silent catches; alerting.' },
  { key:'L9',  qs:'13',      group:false, brief:'Architecture & reuse. Owns J. CORE modules exist and are the only path; triage std.* hits in standard-scan.json by CORE module; promote copy-paste; dead code.' },
  { key:'L10', qs:'12',      group:false, brief:'Design system, theme & a11y. Owns F+G (G first). Both modes; one token source + icon registry; same meaning = same colour/icon app-wide; contrast; 4 states; WCAG 2.2 AA.' },
  { key:'L11', qs:'16',      group:false, brief:'Performance & concurrency. Budgets, N+1, indexes, pagination, timeouts, bounded concurrency, idempotency, multi-replica.' },
  { key:'L12', qs:'10,11',   group:false, brief:'Tests & help. Feature→test map across unit/integration(denied)/e2e/walkthrough (TEST-0,6,7); missing kinds with exact spec; run suite; e2e authenticated, both themes. Help per standard §6G: screen entry, field help, teaching errors/empty states, docs/user page, current.' },
]
const QUICK = ['L5','L6','L7','L8','L9']
const active = CONFIG.profile === 'quick' ? LENSES.filter(l => QUICK.includes(l.key)) : LENSES

const PREAMBLE = `You are one reviewer in a client-acceptance review of ${CONFIG.appName} (${CONFIG.repoPath}).
Follow ~/code/APP_REVIEW.md: Prime Directive (default INCOMPLETE, PASS only with positive evidence), §3 archetypes,
§4 Day-1 walkthrough with blocked_at, §5 rubric. Read ${CONFIG.qaDir}/context.md; do NOT re-derive it or re-report
known non-defects. Cite ~/code/ENGINEERING_STANDARD.md rule IDs. Read excerpts only. Write NO files.
Return ONLY findings in the schema; snippets <= 8 lines.`

const FINDING = { type:'object', properties:{
  id:{type:'string'}, q:{type:'integer'}, lens:{type:'string'}, screen:{type:'string'}, route:{type:'string'},
  api:{type:'string'}, cell:{type:'string'}, archetype:{type:'string'}, standard_ref:{type:'string'},
  severity:{type:'string', enum:['P0','P1','P2','P3','PASS','INCOMPLETE']}, mode:{type:'string'}, role:{type:'string'},
  evidence:{type:'string'}, observed:{type:'string'}, expected:{type:'string'}, blocked_at:{type:'integer'},
  ship:{type:'string'}, viability:{type:'string'}, decision:{type:'string'}, lineage_gap:{type:'string'},
  field_spec:{type:'string'}, canonical:{type:'string'}, unconfirmed:{type:'string'}, fix:{type:'string'},
  effort:{type:'string'}, confidence:{type:'string'} },
  required:['id','q','lens','screen','cell','severity','evidence','confidence'] }
const FINDINGS = { type:'object', properties:{ findings:{ type:'array', items: FINDING } }, required:['findings'] }
const VERDICTS = { type:'object', properties:{ verdicts:{ type:'array', items:{ type:'object', properties:{
  id:{type:'string'}, refuted:{type:'boolean'}, severity:{type:'string'}, reason:{type:'string'} },
  required:['id','refuted','reason'] } } }, required:['verdicts'] }

// ── Review ───────────────────────────────────────────────────────────────────
phase('Review')
const tasks = active.flatMap(l =>
  CONFIG.profile === 'full' && l.group ? CONFIG.groups.map(g => ({ l, g })) : [{ l, g: null }])
const byLens = await parallel(tasks.map(({ l, g }) => () =>
  agent(`${PREAMBLE}\n\nLENS ${l.key} — questions ${l.qs}. ${l.brief}\nSCOPE: ${g ? `menu-group "${g}" only` : 'whole app'}.`,
    { label: `${l.key}:${g || 'app'}`, phase: 'Review', schema: FINDINGS })
    .then(r => (r?.findings || []).map(f => ({ ...f, lens: l.key })))))
const raw = byLens.filter(Boolean).flat()

// ── Verify: one adversarial verifier per lens, P0/P1 only ────────────────────
// A missing/failed verifier is NOT a refutation — only an explicit refuted:true removes a finding.
phase('Verify')
const serious = raw.filter(f => f.severity === 'P0' || f.severity === 'P1')
const lensKeys = [...new Set(serious.map(f => f.lens))]
const verdictLists = await parallel(lensKeys.map(k => () => {
  const batch = serious.filter(f => f.lens === k)
  return agent(`Adversarially verify these ${batch.length} findings against ${CONFIG.repoPath}. For each: open the evidence,
try to REFUTE it (does it reproduce? is it really a defect, or a documented non-defect in ${CONFIG.qaDir}/context.md?
is the severity right?). Set refuted:true only with concrete counter-evidence. Archetype H/I findings: run or trace
them, don't just read. Optionally correct severity.\n\n${JSON.stringify(batch)}`,
    { label: `verify:${k}`, phase: 'Verify', schema: VERDICTS }).then(r => r?.verdicts || [])
}))
const verdicts = new Map(verdictLists.filter(Boolean).flat().map(v => [v.id, v]))
const kept = raw.filter(f => verdicts.get(f.id)?.refuted !== true)
  .map(f => { const v = verdicts.get(f.id); return v?.severity ? { ...f, severity: v.severity, verified: true } : { ...f, verified: !!v } })

// ── Synthesize ───────────────────────────────────────────────────────────────
phase('Synthesize')
const report = await agent(`You are the synthesizer for the ${CONFIG.appName} review. Using ONLY the findings below,
write the report exactly as specified in ~/code/APP_REVIEW.md §10. First sentence answers "can I hand this to a
customer on Monday?". Dedupe same screen+issue (keep highest confidence). Do not invent findings.
\n\nFINDINGS:\n${JSON.stringify(kept)}`, { label: 'synthesize', phase: 'Synthesize' })

const count = (k) => kept.reduce((m, f) => ((m[f[k]] = (m[f[k]] || 0) + 1), m), {})
return { total: kept.length, refuted: raw.length - kept.length, bySeverity: count('severity'), byShip: count('ship'), report }
```

Then write `report` → `{{QA_DIR}}/review-report.md` and `kept` → `{{QA_DIR}}/review-findings.json`.
**Without the Workflow tool:** launch the active lenses as parallel `Agent` calls in one message
(preamble + card + scope + schema), then one verifier per lens for P0/P1, then one synthesizer.

### 8.3 Token discipline
Shared context built once · excerpts not files · structured-only returns · one lens per agent ·
PASS is one line · reuse prior results; never re-discover known non-defects.

### 8.4 Live dimension
Static review misses whole archetypes. Where possible run the app and **drive it** (Playwright plugin),
as each role. Classify actions **R** (read) / **M** (reversible mutation) / **D** (destructive). Fire
only R and reversible M (create `qa-*` records, then undo). **Never fire D** — preview only. After each
M assert the **audit invariant**: the event appears in audit + activity with actor, role, request_id,
outcome. Production and real external systems are read/preview only. Every "it works" claim about
behaviour is backed by having watched it work.

### 8.5 No-clobber protocol (only when agents write fixes)
1. One agent, one worktree, pinned to an explicit, verified base commit.
2. Patches go to a scratch directory outside the repo; agents never write the working tree.
3. The orchestrator applies patches **serially**, running the gate between each.
4. Pre-assign collision-prone resources (migration numbers above all).
5. Shared files (router/nav, design tokens, UI primitives, platform core) are owned by exactly one agent.

---

## 9 · Release gate

### 9.1 Security gate — must be green before any deploy (L6 runs it; paste output)
- [ ] `gitleaks detect` (full history) — zero findings; any secret found in history is rotated and recorded in STANDARD_EXCEPTIONS (SEC-11).
- [ ] Dependency CVEs: `osv-scanner` / `govulncheck` / `npm audit --audit-level=high` / `pip-audit` — no Critical/High introduced by this release, and none past its VULN-2 fix-time target (SEC-15).
- [ ] Agent config (§2C): AGT-1 deny rules and bypass disabled, AGT-7 subagent `tools:`, AGT-5 pinned MCP servers; headless agent workflows meet AGT-6.
- [ ] Supply chain (§2E): NPM-1/SUP-1 cooldown config present; images verified before deploy (SUP-4); nothing deployable within 90 days of EOL (LIFE-1).
- [ ] SAST: `semgrep --config p/default --config p/owasp-top-ten` — zero unwaived High.
- [ ] Standard kit: `tools/standard/check.sh` green — token validation, no generated-code drift, zero **new** `std.*` violations vs baseline (any `std.*.sql-*`, `*tls-bypass`, `*insecure-token-storage`, `*token-in-localstorage`, `*secret-in-log` hit is a P0 regardless of baseline).
- [ ] `trivy fs .` and `trivy config .` (IaC/Dockerfiles) — zero Critical/High introduced by this release or past their VULN-2 deadline (SEC-15); images: `trivy image`.
- [ ] CI: `zizmor .github/workflows` clean; actions pinned to SHA.
- [ ] Client bundle / mobile artifact contains only allow-listed public keys (fetch live bundle; `unzip` IPA/AAB).
- [ ] RBAC boundary test + IDOR test pass against a running instance.
- [ ] Live URL: `node ~/code/engineering-standard/site/check-site.mjs <every hostname>` — **zero ERRORs** (TLS, http→https, CSP/HSTS/nosniff/frame-ancestors, cookies, exposed files, directory listing, public source maps); CORS is an explicit allow-list.
- [ ] Websites: `site/check-build.mjs` passes on the exact directory the deploy uploads (WEB-1, WEB-11).
- [ ] OWASP Top 10, **OWASP API Security Top 10** (API-12) and LLM Top 10 if applicable: pass/fail per item; ASVS Level 1–2 gaps from `mappings/ASVS-5.0.md` that apply to this app are listed.
- [ ] Vulnerability management: `SECURITY.md` present; no findings past their VULN-2 fix-time target; OpenSSF Scorecard running, score and any drop reported (target ≥ 7/10, VULN-6).

### 9.2 Release checklist (from QA_PLAYBOOK; tags: [web] [mobile] [api] — skip tags that don't apply)
- [ ] **Screen × state matrix**: happy path + empty/error/loading for every route; dead links; edge cases (0/1/max items, deleting in-use objects, last member leaves).
- [ ] [mobile][web] **Deep links**: cold open signed-out → auth → resume; expired/wrong-env link.
- [ ] **Outbound integrations** open the right target (mailto RFC 3986, SMS, WhatsApp, calendar, payments); [mobile] `LSApplicationQueriesSchemes` / Android `<queries>` declared.
- [ ] **UX**: keyboard never occludes the focused field; long strings ellipsize; rotation; font scale 200%; tap targets.
- [ ] **Theme**: light/dark + every preset on a smoke set (golden tests / Playwright screenshots).
- [ ] **Performance**: budgets (PERF-1) measured — Lighthouse CI [web], cold start on mid-tier device [mobile], `k6` smoke at expected load [api].
- [ ] **Resources**: 30-min session heap stable; subscriptions/streams disposed; media engines released.
- [ ] **Network**: offline launch, slow network with timeouts, token expiry mid-session, reconnect backfill, 5xx shows actionable error with request_id.
- [ ] **Observability**: crash reporter live with release tag + symbols (dSYM / R8 mapping); alert rules fire in a test.
- [ ] **Build hardening**: release builds minified/obfuscated; min-version / kill-switch on cold start; versioned API routes.
- [ ] [mobile] **Store floors** (§6J): target API / SDK floor (STORE-1), 16 KB alignment (STORE-2), Android 16 readiness (STORE-3), account deletion in-app and on the web (STORE-4), no secrets in the binary (FLT-1), rollout halts on vitals thresholds (STORE-8).
- [ ] **Data**: migrations dry-run in a transaction with rollback tested; a backup restore test within the last quarter (OPS-3).
- [ ] **Reliability**: `docs/SLO.md` with burn-rate alerts (REL-1), incident section of `docs/RUNBOOK.md` (REL-3), last DR rehearsal date within 6 months (REL-5).
- [ ] **A11y / i18n / legal**: accessibility scan (`@axe-core/playwright`, platform inspectors); strings externalized; privacy policy, terms, data export/delete reachable; store listing parity.

---

## 10 · Deliverables & definition of done

`{{QA_DIR}}/review-report.md`, in this order:

1. **Headline** — first sentence answers *"can I hand this to a customer on Monday?"*, then **Go / No-Go**
   for deploy and the **ship-verdict distribution** (e.g. "3 SHIP · 5 CAVEAT · 12 NOT-SHIPPABLE"). If it's
   bad, that is the headline — don't bury it under a findings count.
2. **Scorecard** — the 17 questions, each `PASS / AT-RISK / FAIL / N-A / INCOMPLETE` + one-line why.
3. **Standard compliance** — pillar by pillar (Secure · Optimized · Shared · Observable): rules met /
   broken, with IDs.
4. **Security gate result** (§9.1) with scan output.
5. **Feature matrix** — feature × {blocked_at, viability, ship, source, entry, authz, audit, tests, darkmode}.
6. **P0 / P1 register** — `ID · lens · severity · file:line · observed → expected · fix · effort · verified`.
7. **Producer × sink matrix** (L8) and **shared-core map** (L9) with bypasses.
8. **Prioritized remediation plan** — P0 → P1 → P2, sequenced by blast radius; durable fixes (lint rule,
   core module, e2e sweep) before one-off patches.
9. **Gap register & improvements** (Q17).

Raw verified findings → `{{QA_DIR}}/review-findings.json`.

**Done when:**
- [ ] Every feature has both verdicts (`viability`, `ship`); none skipped for being boring.
- [ ] Every `PASS` has positive evidence; every `INCOMPLETE` names what wasn't verified.
- [ ] Every P0/P1 has file, line, concrete fix, effort, and survived adversarial verification.
- [ ] Every archetype H and I finding was verified by **running** it, not reading it.
- [ ] Security gate result stated explicitly; no deploy recommended while it is red.
- [ ] Baseline gate still green; read-only unless fixes were requested.

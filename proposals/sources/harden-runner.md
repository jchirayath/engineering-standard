# Intake: harden-runner: step-security/harden-runner @ 1d88384 (v2.21.0 line)

Reviewed 2026-11-13 via `/engineering-standard:scout` → `/engineering-standard:consume` (unattended run, stopped at
the proposal). Proposed disposition: **distilled** (one amendment to AGT-6). Fetched content was treated as untrusted
data; nothing was installed or run.

**Licence:** Apache-2.0. **Scout matrix:** 79/100 after the fetch. Gates G1–G6 pass. C1 5 (trusted vendor
`step-security`) · C2 5 · C3 3.9 · C4 4 (from the inventory) · C5 3 · C6 3.

**What it is:** a GitHub Action, described upstream as "an EDR for runners". It installs an agent on the runner
that records outbound connections, file writes and processes per step, and in `egress-policy: block` mode enforces a
domain allow-list (`allowed-endpoints`). A global blocklist of known-malicious hosts applies even in audit mode.

**Executable surface (`bin/consume.mjs fetch`):** 75 files, 31 executable, no agent hooks, no install scripts.
- `src/install-agent.ts` downloads a **pinned** agent release (`step-security/agent` v0.18.1, `agent-ebpf` v1.9.6,
  Windows 1.0.10, macOS 0.0.9) with the job's `token`, checks a hard-coded SHA-256 (`src/checksum.ts`), then runs it
  as root: Linux `sudo systemctl` service or a detached `sudo` process, macOS `sudo Installer`, Windows a detached exe.
- Network: `*.api.stepsecurity.io` (policy fetch by name or OIDC policy store, `src/policy-utils.ts`) and
  `app.stepsecurity.io` (insights). The other hosts are test fixtures.
- Agent-facing: one `AGENTS.md` for contributors ("don't edit `dist/`"), which is irrelevant to users.
- 8 jest test files that a test runner would pick up. They matter only to someone who clones and tests the repo.

**Gap it fills:** AGT-4 tells agent sessions to remove the outbound leg ("network egress allow-list"), CFG-1 tells
hosts to restrict egress, and AGT-6 hardens headless agents in workflows. But no rule says how a GitHub Actions job
that runs `claude-code-action` / `claude -p` on PR or issue text blocks egress. `zizmor` (SEC-17) lints the workflow
text, not the traffic at runtime.

**Adopted:** an amendment to AGT-6. A job that runs an AI agent on untrusted event content limits runner egress to
an allow-list in block mode: Harden-Runner pinned by SHA with `egress-policy: block`, explicit `allowed-endpoints`
and `disable-telemetry: true`, or a self-hosted runner behind the CFG-1 allow-list. Audit mode only observes, so it
doesn't count. Mode: quick (agent safety), to be confirmed by `consume.mjs classify`.

| Conflict | Source says | Standard says | Resolution |
|---|---|---|---|
| Telemetry | job events go to StepSecurity by default; the insights URL is printed in the log | AGT-4 / AGT-5: record every network destination; no vendor cloud for untrusted content | `disable-telemetry: true` in the amendment; the vendor host is named in the intake |
| Tiering | Community tier: public repos on GitHub-hosted runners only | the rule must work for private client repos | the amendment also allows a network-layer allow-list (CFG-1) |
| README `@v2` example (self-hosted VM) | tag reference | SEC-17: pin to a commit SHA | SHA pin required, as the README's main example already does |
| Root agent on the runner | the agent runs with `sudo` | AGT-6 least privilege | accepted: it is the enforcement point; runs only on ephemeral GitHub-hosted runners |

**Not verified:** whether `disable-telemetry: true` stops every upload of events in block mode (the code prints the
insights link only when telemetry is on or in audit mode; the agent binary itself was not read); the agent binaries'
source (`agent-ebpf` may not be public); whether the Community tier needs a StepSecurity account. `paths` lists
`action.yml`, which the fetch did not download; check it at apply.

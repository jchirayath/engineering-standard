# Intake: numbat: perplexityai/numbat @ ebb511f (main)

Reviewed 2026-11-16 by the daily scout → `/engineering-standard:consume` (unattended run, stopped at the proposal).
Proposed disposition: **distilled** (one tool-agnostic amendment to AGT-10). Fetched content was treated as untrusted
data; nothing was installed or run.

**Licence:** Apache-2.0. **Scout matrix:** 73/100 after the fetch (70 before it). Gates G1–G6 pass. C1 4 · C2 4.3 ·
C3 3.8 · C4 4 (from the inventory) · C5 3 · C6 3. The fetch reported hooks as "unknown", so C4 doesn't count the
hooks the tool installs. Counting them (−1 hooks, −1 every-prompt and subagent hooks) and the unpinned `@latest`
install (−1) gives C4 2 and a total of 67, which is watch. That is why the recommendation is **hold**.

**What it is:** a single Go binary that watches AI agents on an endpoint. It reads live events from hooks, plugins
and OTLP/HTTP log exporters. It can also rebuild past sessions from the session files agents leave on disk, with no
earlier setup needed. Events go into one data model and a CEL rule engine runs detections (secret reads, exfiltration
one-liners, privilege escalation, sequence rules such as "secret read then egress"). Records are versioned NDJSON
written to stdout, a local file, or an HTTP sink. Blocking is opt-in and every shipped rule is monitor-only.

**Executable surface (`bin/consume.mjs fetch`):** 490 files, 51 agent-facing, 317 executable.
- **Hooks it installs:** `numbat hook install --agent claude` writes 11 command hooks into the user-level Claude Code
  `settings.json` (atomic write, mode 0600): SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
  PostToolUseFailure, PermissionRequest, PermissionDenied, Stop, SessionEnd, SubagentStart and SubagentStop
  (`internal/hook/install.go`). So it runs on every prompt and every subagent. Hook stdout is reserved for the
  agent protocol, and monitor mode returns no decision, so nothing is injected into context.
- **Enforcement:** used only with `--enforce` and operator-copied rules marked `enforce: true`. It **fails open** on
  malformed payloads and decision errors (`cmd/numbat/hook.go`).
- **Network:** only the HTTP sink the operator configures (`cmd/numbat/sink.go`; bearer or HMAC secrets come from
  env vars, never flags; an `allowInsecure` option exists). The 18 hosts the fetch found are test fixtures
  (`*.example`) or documentation URLs. No telemetry was found in the files that were read.
- **Install:** release binaries with SHA-256 checksums (fine). The README also offers
  `go install …/cmd/numbat@latest`, which is unpinned (AGT-5).
- **Data:** records include hostname, username, uid, project path, commands and URLs. Secrets are redacted, but the
  README warns that records can still hold sensitive context. Under AGT-10 they belong in the LOG-9 store.

**Gap it fills:** AGT-10 asks agent sessions to export OpenTelemetry, but many agent CLIs don't. No rule says how
to audit those, or that a monitor-only or fail-open hook is not a control.

**Adopted:** an amendment to AGT-10 that names no tool (in line with the owner's 2026-11-13 harden-runner
decision). When an agent CLI has no OTel export, a local monitor records its hook events or session files into the
same store. The monitor comes from a pinned, checksum-verified release, and the hooks it writes are reviewed as
agent configuration (AGT-9). A monitor-only hook, or one that lets an action through when its rule engine errors,
is audit evidence and is never cited as the enforcement of a MUST rule. The amendment deliberately makes no claim
about the plugin's own hooks. The offline test suite shows `guard-files` exits 0 on garbage stdin ("fails open"),
so the owner may want a separate look at whether AGT-1's hook should deny on malformed input.

| Conflict | Source says | Standard says | Resolution |
|---|---|---|---|
| Install | `go install …@latest` | AGT-5 / SEC-15: pin exact versions | amendment requires a pinned, checksum-verified release |
| Hook placement | writes hooks to user-level `~/.claude/settings.json` | AGT-9: agent config is privileged and reviewed | amendment: hooks written by the monitor are reviewed as agent configuration |
| Enforcement | fails open on decision errors | AGT-2 fails closed; AGT-1 / AGT-17 cite blocking hooks | amendment: monitor-only or error-passing hooks are never cited as a MUST control |
| HTTP sink | `allowInsecure` option | SEC transport rules (TLS) | not adopted; the amendment points records to the LOG-9 store |

Overlaps in the ledger: Tracekit (watch, 64) adds signed, hash-chained records, which LOG-9 already allows as an
optional hash chain. hol-guard, prismor, solongate and Adrian (watch) are runtime guards that overlap the plugin's
PreToolUse hooks. uber/ADR (watch, 60) sends sessions to hosted LLMs.

**Not verified:** 171 of 490 files were not read because of the 200-file limit. They include `internal/discover/*`,
`internal/extract/claude*.go` and `internal/casebundle/*`, so the claim of "outbound only to configured sinks" is
checked only for the files that were read. The HTTP delivery code (the `ship` command) was not read. The release
checksums were not checked against a build. `docs/enforcement.md` and `docs/agent-coverage.md` were not downloaded.
`consume.mjs apply --dry-run` was not run, so `similar --check` was not run against the amended AGT-10. The scout's
C4 of 4 doesn't count hooks (the fetch reported "hooks: unknown"). The plugin's `guard-files` hook is tested to fail
open on garbage stdin. That is outside this intake, but it bears on the amendment's last sentence.

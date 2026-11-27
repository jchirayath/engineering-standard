# Intake: Bumblebee: perplexityai/bumblebee @ 93b8877 (v0.1.2 line)

Reviewed 2026-11-18 via the scheduled scout → `/engineering-standard:consume` (unattended run, stopped at the
proposal). Proposed disposition: **distilled** (one amendment to VULN-3). Fetched content was treated as untrusted
data; nothing was installed or run.

**Licence:** Apache-2.0. **Scout matrix:** 82/100 after the fetch. Gates G1–G6 pass. C1 4 · C2 4.3 · C3 4.6 · C4 4
(from the inventory) · C5 4 · C6 4.

**What it is:** a read-only inventory collector for macOS and Linux developer endpoints. It reads lockfiles, install
metadata and manifests for npm, pnpm, Yarn, Bun, PyPI, Go, RubyGems, Composer, Homebrew, editor extensions (VS Code,
Cursor, Windsurf, VSCodium), browser extensions, MCP host configs and agent skills (skills.sh lock files). It never runs
a package manager. Given an exposure catalog (exact name and version entries), it emits NDJSON findings and a
`scan_summary`. Sample catalogs built from public threat reporting ship in `threat_intel/`.

**Executable surface (`bin/consume.mjs fetch`):** 105 files, 58 executable, 0 agent-facing, no hooks, no install
scripts.
- Network: the scanner makes no outbound calls of its own. `--output=http --http-url` POSTs results to an
  operator-chosen URL (https required unless loopback; `--http-auth bearer|hmac-sha256` with the secret read from an env
  var). `tools/osvcatalog` builds catalogs offline from osv-vulnerabilities.storage.googleapis.com, and
  `internal/osv/osv.go` says the scanner never contacts osv.dev. The other hosts flagged by the inventory
  (registry.npmjs.org, api.github.com, rubygems.org, *.example.com, mcp.stripe.com) are test fixtures.
- MCP config `env` values are not emitted, so secrets in MCP configs don't end up in the output.
- Distribution: `go install …@latest` in the README (unpinned); GitHub releases v0.1.1 (2026-05-22) and v0.1.2
  (2026-06-18); main is well ahead.

**Gap it fills:** VULN-3 monitors the default branch and the latest release, and SEC-15 gates new dependencies. Nothing
in the standard says what to do about the *machines*. A published compromise (Shai-Hulud style npm/PyPI worms,
malicious IDE extensions, a poisoned MCP server or skill) runs on developer laptops and CI runners, where it steals the
credentials that matter. AGT-5 vets what reaches the agent before intake, not what is already installed.

**Adopted:** an amendment to VULN-3. When a compromise is published, endpoints and runners are checked against the named
versions within VULN-2's Critical window. A hit starts REL-3 and rotates that machine's credentials. Bumblebee, built
from a pinned release tag, is named only as an example.

| Conflict | Source says | Standard says | Resolution |
|---|---|---|---|
| Install | `go install github.com/perplexityai/bumblebee/cmd/bumblebee@latest` | AGT-5 / SEC-15: pinned, reviewed versions | the amendment requires a pinned release tag |
| Result upload | `--output=http` sends the inventory to any URL | AGT-4 / SEC-13: inventory of a dev machine is sensitive | results stay local or go only to a team-owned HTTPS endpoint |
| Catalog freshness | sample catalogs in `threat_intel/` | AGT-13: no claim without evidence | a clean result means "not in this catalog", recorded with the catalog's date |

**Not verified:** whether v0.1.2 (the latest release) already includes the MCP-config, skills and extension collectors
that main has; whether the release assets are signed or carry provenance (the tag commit is signed); the network
behaviour of the compiled binary (only the source was read, and nothing was run); the false-negative rate of the
collectors; the contributor count.

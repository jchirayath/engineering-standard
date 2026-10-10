#!/usr/bin/env bash
# One-time per clone: use the repo's hooks (owner-data + secret checks before every commit).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
command -v gitleaks >/dev/null || echo "Note: install gitleaks (brew install gitleaks) — the pre-commit hook requires it."
[ -f local/denylist.txt ] || printf '%s\n' "# Private terms that must never be committed (one per line; 're:' prefix = regex)." "# e.g. your domains, app names, analytics IDs, hostnames, email addresses." > local/denylist.txt
echo "✓ hooks installed (.githooks); edit local/denylist.txt with your private terms."

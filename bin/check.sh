#!/usr/bin/env bash
# One command for local runs, pre-commit and CI (vendored into <repo>/tools/standard/check.sh).
#   tools/standard/check.sh              validate tokens → regenerate → fail on drift → lint
#   tools/standard/check.sh --baseline   record current lint findings to .semgrep/baseline.json (adoption)
# With a baseline present, only NEW findings fail; fix old ones and re-baseline to shrink it.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
TOOLS="tools/standard/design-tokens/scripts"
[ -d "$TOOLS" ] || TOOLS="$(cd "$(dirname "$0")/.." && pwd)/design-tokens/scripts"   # running from the kit itself
SEMGREP="$(command -v semgrep || echo 'pipx run semgrep')"
status=0

if [ -d design/tokens ]; then
  echo "▸ tokens: validate"
  node "$TOOLS/validate.mjs" --design design || status=1
  echo "▸ tokens: build"
  node "$TOOLS/build.mjs" --design design >/dev/null || status=1
  # Drift check covers ONLY generated outputs (design/build + any "out" dirs in tokens.config.json).
  GEN="design/build $(node -e "try{const c=require('./design/tokens.config.json');console.log(Object.values(c.out||{}).join(' '))}catch{}")"
  if git rev-parse --git-dir >/dev/null 2>&1 && [ -n "$(git status --porcelain -- $GEN 2>/dev/null)" ]; then
    if [ -n "${CI:-}" ]; then echo "✗ generated theme code is out of date — run tools/standard/check.sh and commit"; git status --short -- $GEN; status=1
    else echo "  (regenerated theme files changed — commit them)"; fi
  fi
fi

if [ -f standard.config.json ] && grep -q '"site"' standard.config.json; then
  PUB="$(node -e "console.log(require('./standard.config.json').site.publishDir||'')")"
  if [ -n "$PUB" ] && [ "$PUB" != "." ]; then
    echo "▸ site: pre-deploy scan of $PUB (WEB-*)"
    SB="tools/standard/site/check-build.mjs"; [ -f "$SB" ] || SB="$(cd "$(dirname "$0")/.." && pwd)/site/check-build.mjs"
    HT="$(node -e "console.log(require('./standard.config.json').site.host||'')")"
    node "$SB" "$PUB" ${HT:+--host "$HT"} || status=1
  fi
fi

echo "▸ tests: feature → test map (TEST-7)"
CT="tools/standard/check-tests.mjs"; [ -f "$CT" ] || CT="$(cd "$(dirname "$0")" && pwd)/check-tests.mjs"
node "$CT" || status=1

echo "▸ lint: engineering-standard rules"
if [ "${1:-}" = "--baseline" ]; then
  $SEMGREP --metrics=off --config .semgrep/standard --json -q . > .semgrep/baseline.json || true
  python3 - <<'PY'
import json
d = json.load(open('.semgrep/baseline.json'))
def src(p, l):
    try: return open(p, encoding='utf-8', errors='replace').read().splitlines()[l - 1].strip()
    except Exception: return ''
json.dump({'keys': [[r['check_id'], r['path'], src(r['path'], r['start']['line'])] for r in d['results']],
           'results': [{'check_id': r['check_id'], 'path': r['path'], 'start': r['start']} for r in d['results']]},
          open('.semgrep/baseline.json', 'w'), indent=1)
PY
  n=$(python3 -c "import json;print(len(json.load(open('.semgrep/baseline.json'))['keys']))")
  echo "  baseline recorded: $n existing findings in .semgrep/baseline.json (commit it; shrink it over time)"
elif [ -f .semgrep/baseline.json ]; then
  $SEMGREP --metrics=off --config .semgrep/standard --json -q . > /tmp/semgrep-now.$$.json || true
  python3 - "$$" <<'PY' || status=1
import json, sys
# Match on rule + file + the offending source line's text (not its line number), so edits above don't
# turn old findings into "new" ones. Identical lines in one file share a key (counted as a multiset).
from collections import Counter
def src(path, line):
    try: return open(path, encoding='utf-8', errors='replace').read().splitlines()[line - 1].strip()
    except Exception: return ''
def keys(results, texts=None):
    return Counter((r['check_id'], r['path'], texts[i] if texts else src(r['path'], r['start']['line'])) for i, r in enumerate(results))
base = json.load(open('.semgrep/baseline.json'))
oldk = Counter(tuple(k) for k in base.get('keys', [])) or keys(base['results'])
now = json.load(open(f'/tmp/semgrep-now.{sys.argv[1]}.json'))['results']
budget, new = Counter(oldk), []
for r in now:
    k = (r['check_id'], r['path'], src(r['path'], r['start']['line']))
    if budget[k] > 0: budget[k] -= 1
    else: new.append(r)
for r in new: print(f"✗ {r['path']}:{r['start']['line']}  {r['check_id'].split('std.')[-1]}  {r['extra']['message']}")
print(f"  {len(now)} findings, {len(new)} new vs baseline ({sum(oldk.values())})")
sys.exit(1 if new else 0)
PY
else
  $SEMGREP --metrics=off --config .semgrep/standard --error . || status=1
fi

[ $status -eq 0 ] && echo "✓ engineering-standard checks passed" || echo "✗ engineering-standard checks failed"
exit $status

#!/usr/bin/env bash
# Vendor the engineering-standard kit into a repo (idempotent; re-run to upgrade).
#   adopt.sh <repo-path>                                   app  (Flutter / web app / Go / Python / Swift)
#   adopt.sh <repo-path> --site swa|netlify|apache|caddy|nginx [--url https://example.com]   website
# Kit-owned (overwritten on every run): .semgrep/standard/, tools/standard/
# Repo-owned (created only if absent):  .semgrepignore, design/, standard.config.json, docs/STANDARD_EXCEPTIONS.md,
#                                       site header config, .well-known/security.txt
set -euo pipefail
KIT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "${1:?usage: adopt.sh <repo-path> [--site <host>] [--url <https://…>]}" && pwd)"; shift
SITE=""; URL=""
while [ $# -gt 0 ]; do case "$1" in
  --site) SITE="${2:?--site needs swa|netlify|apache|caddy|nginx}"; shift 2 ;;
  --url)  URL="${2:?--url needs https://…}"; shift 2 ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac; done
VERSION="$(cat "$KIT/VERSION")"

copy_owned() { mkdir -p "$(dirname "$2")"; rm -rf "$2"; cp -R "$1" "$2"; }
copy_if_absent() { if [ -e "$2" ]; then echo "  keep     ${2#$REPO/}"; else mkdir -p "$(dirname "$2")"; cp -R "$1" "$2"; echo "  created  ${2#$REPO/}"; fi; }

echo "Adopting engineering-standard v$VERSION into $REPO${SITE:+ (website, host: $SITE)}"

# 1. Lint rules (kit-owned). Fixtures stay in the kit; only rules are vendored.
mkdir -p "$REPO/.semgrep/standard"
rm -f "$REPO/.semgrep/standard/"*.yml
cp "$KIT"/semgrep/*.yml "$REPO/.semgrep/standard/"
echo "  updated  .semgrep/standard/ ($(ls "$KIT"/semgrep/*.yml | wc -l | tr -d ' ') rule files)"
copy_if_absent "$KIT/semgrep/semgrepignore.template" "$REPO/.semgrepignore"

# 2. Tooling (kit-owned).
mkdir -p "$REPO/tools/standard"
cp "$KIT/bin/check.sh" "$KIT/bin/check-tests.mjs" "$REPO/tools/standard/"
copy_owned "$KIT/site" "$REPO/tools/standard/site"
if [ -z "$SITE" ]; then
  copy_owned "$KIT/design-tokens/scripts" "$REPO/tools/standard/design-tokens/scripts"
  copy_owned "$KIT/design-tokens/schema"  "$REPO/tools/standard/design-tokens/schema"
fi
echo "$VERSION" > "$REPO/tools/standard/VERSION"
if [ -n "$SITE" ]; then echo "  updated  tools/standard/ (check.sh, check-tests.mjs, site/)"; else echo "  updated  tools/standard/ (check.sh, check-tests.mjs, site/, design-tokens/)"; fi

# 3. Repo-owned starting points.
mkdir -p "$REPO/docs"
copy_if_absent "$KIT/templates/SECURITY.md" "$REPO/SECURITY.md"
if [ -d "$REPO/.github" ] || git -C "$REPO" remote -v 2>/dev/null | grep -q github.com; then
  copy_if_absent "$KIT/templates/github/scorecard.yml" "$REPO/.github/workflows/scorecard.yml"
fi
[ -e "$REPO/docs/STANDARD_EXCEPTIONS.md" ] || { printf '# Standard exceptions\n\n| Rule | Where | Reason | Owner | Expires |\n|---|---|---|---|---|\n' > "$REPO/docs/STANDARD_EXCEPTIONS.md"; echo "  created  docs/STANDARD_EXCEPTIONS.md"; }

if [ -n "$SITE" ]; then
  case "$SITE" in
    swa)     copy_if_absent "$KIT/site/headers/staticwebapp.config.json" "$REPO/staticwebapp.config.json" ;;
    netlify) copy_if_absent "$KIT/site/headers/netlify.toml" "$REPO/netlify.toml" ;;
    apache)  copy_if_absent "$KIT/site/headers/htaccess" "$REPO/.htaccess" ;;
    caddy)   copy_if_absent "$KIT/site/headers/Caddyfile" "$REPO/security_headers.caddy" ;;
    nginx)   copy_if_absent "$KIT/site/headers/nginx.conf" "$REPO/security_headers.nginx.conf" ;;
    *) echo "unknown --site host: $SITE (swa|netlify|apache|caddy|nginx)" >&2; exit 2 ;;
  esac
  DOMAIN="${URL#https://}"; DOMAIN="${DOMAIN%%/*}"
  if [ ! -e "$REPO/.well-known/security.txt" ]; then
    mkdir -p "$REPO/.well-known"; sed "s/{{DOMAIN}}/${DOMAIN:-example.com}/g" "$KIT/site/headers/security.txt" > "$REPO/.well-known/security.txt"
    echo "  created  .well-known/security.txt (check the Contact: address)"
  fi
  [ -e "$REPO/standard.config.json" ] || { printf '{\n  "site": {\n    "urls": ["%s"],\n    "forbid": [],\n    "publishDir": "."\n  }\n}\n' "${URL:-https://example.com}" > "$REPO/standard.config.json"; echo "  created  standard.config.json (site.urls, site.forbid, site.publishDir)"; }
  cat <<EOF

Next steps (website)
  1. Make the deploy ship ONLY public files: stage an allowlist into a temp dir (WEB-1) and set
     site.publishDir; list private paths that must 404 in site.forbid (admin pages, server code, auth files).
  2. In deploy.sh, BEFORE upload:   node tools/standard/site/check-build.mjs "\$STAGE" || exit 1
                   AFTER upload:    node tools/standard/site/check-site.mjs --config standard.config.json || exit 1
  3. Ship the header config with the site (it must be inside the staged dir for swa/netlify/apache).
  4. CLAUDE.md:  Follow ~/code/ENGINEERING_STANDARD.md §2A (kit v$VERSION in tools/standard). Exceptions: docs/STANDARD_EXCEPTIONS.md
  5. Existing site? Run check-site.mjs against the live URL now; fix ERRORs first, then WARNs.
EOF
  exit 0
fi

copy_if_absent "$KIT/design-tokens/template/tokens"     "$REPO/design/tokens"
copy_if_absent "$KIT/design-tokens/template/icons.json" "$REPO/design/icons.json"
if [ ! -e "$REPO/design/tokens.config.json" ]; then
  plats='"css", "tailwind4", "ts"'; out='{}'
  [ -f "$REPO/pubspec.yaml" ] && { plats='"dart"'; out='{ "dart": "lib/core/design/generated" }'; }
  ls "$REPO"/*.xcodeproj >/dev/null 2>&1 && plats='"swift"'
  printf '{\n  "platforms": [%s],\n  "out": %s\n}\n' "$plats" "$out" > "$REPO/design/tokens.config.json"
  echo "  created  design/tokens.config.json (platforms: $plats)"
fi

cat <<EOF

Next steps (app) — see engineering-standard/README.md "New repo vs existing repo"
  1. Map the app's palette into design/tokens/*.json (keep its look; names are fixed by the schema).
  2. Add a "tests" block to standard.config.json so TEST-7 can map features → tests.
  3. tools/standard/check.sh            # tokens, generated code, TEST-7, lint
     Existing repo: tools/standard/check.sh --baseline  first, then burn the list down.
  4. CLAUDE.md:  Follow ~/code/ENGINEERING_STANDARD.md (kit v$VERSION in tools/standard). Exceptions: docs/STANDARD_EXCEPTIONS.md
  5. CI:         run tools/standard/check.sh (GitHub Actions job in the kit README)
EOF

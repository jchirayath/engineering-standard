#!/bin/bash
# scout-jobs.sh functions on throwaway repos, under macOS /bin/bash 3.2 (what the LaunchAgent runs). Called by run.mjs.
set -u
JOBS="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; T="$(mktemp -d)"; cd "$T"
echo "bash $BASH_VERSION"
source "$JOBS"
set +e
fail=0; check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

# repo_slug
KIT="$T/kit"; git init -q "$KIT"
for u in https://github.com/o/r.git git@github.com:o/r.git https://gitlab.com/o/r.git; do
  git -C "$KIT" remote remove origin 2>/dev/null; git -C "$KIT" remote add origin "$u"; echo "slug $u -> $(repo_slug || echo NONE)"
done

# merge_main: ledger ours, proposals theirs, other conflicts abort
git init -q --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/seed" 2>/dev/null; cd "$T/seed"; git checkout -q -b main
led() { printf '{\n  "a": "%s",\n  "p1": 1,\n  "p2": 2,\n  "p3": 3,\n  "p4": 4,\n  "p5": 5,\n  "z": "%s"\n}\n' "$1" "$2"; }
mkdir -p sources proposals/sources; led base base > sources/candidates.json; echo base > proposals/sources/p.rules.json; echo base > README.md
git add -A; git -c user.email=t@t -c user.name=t commit -qm base; git push -q origin main
WT="$T/wt"; git clone -q -b main "$T/origin.git" "$WT"; git -C "$WT" checkout -q -b scout/daily
git -C "$WT" config user.email t@t; git -C "$WT" config user.name t
led scout base > "$WT/sources/candidates.json"; echo unapplied > "$WT/proposals/sources/p.rules.json"; git -C "$WT" commit -qam scout
led main maindecision > sources/candidates.json; echo applied > proposals/sources/p.rules.json; git -c user.email=t@t -c user.name=t commit -qam main; git push -q origin main
git -C "$WT" fetch -q origin main
merge_main; rc=$?
check "merge_main resolves ledger+proposal conflicts" '[ $rc -eq 0 ]'
check "ledger: the scout wins the conflicting hunk" 'grep -q "\"a\": \"scout\"" "$WT/sources/candidates.json"'
check "ledger: main's non-conflicting hunk is kept" 'grep -q maindecision "$WT/sources/candidates.json"'
check "proposal takes main (applied)" 'grep -q applied "$WT/proposals/sources/p.rules.json"'
echo dirty > "$WT/proposals/sources/p.rules.json"
echo applied2 > proposals/sources/p.rules.json; git -c user.email=t@t -c user.name=t commit -qam p2; git push -q origin main; git -C "$WT" fetch -q origin main
merge_main; rc=$?
check "a merge that fails without a conflict (dirty tree) is reported, not committed" '[ $rc -ne 0 ] && grep -q dirty "$WT/proposals/sources/p.rules.json"'
git -C "$WT" checkout -q -- proposals/sources/p.rules.json; merge_main >/dev/null
echo scoutreadme > "$WT/README.md"; git -C "$WT" commit -qam r
echo mainreadme > README.md; git -c user.email=t@t -c user.name=t commit -qam r2; git push -q origin main; git -C "$WT" fetch -q origin main
merge_main; rc=$?
check "merge_main refuses other conflicts" '[ $rc -ne 0 ]'
check "and leaves no merge in progress" '! [ -f "$WT/.git/MERGE_HEAD" ]'

# restore_code: code the agent changed (tracked, untracked or ignored) goes back to main; its data stays
git -C "$WT" merge --abort 2>/dev/null; git -C "$WT" reset -q --hard origin/main
mkdir -p "$WT/bin" "$WT/local/scout"; echo evil > "$WT/README.md"; echo 'run()' > "$WT/bin/evil.mjs"; echo x > "$WT/bin/cache.pyc"
printf 'local/\n*.pyc\n' > "$WT/.git/info/exclude"; echo keep > "$WT/local/scout/report.md"; echo mine > "$WT/proposals/sources/new.md"
reset="$(restore_code test 2>/dev/null)"
check "restore_code resets tracked, untracked and ignored code" '! grep -q evil "$WT/README.md" && [ ! -e "$WT/bin/evil.mjs" ] && [ ! -e "$WT/bin/cache.pyc" ]'
check "restore_code keeps proposals and local/ and reports what it reset" '[ -f "$WT/proposals/sources/new.md" ] && [ -f "$WT/local/scout/report.md" ] && echo "$reset" | grep -q "bin/evil.mjs" && [ -z "$(restore_code again 2>/dev/null)" ]'

# credential helper: token comes from the environment, prints only for "get"
PR_TOKEN=tok_123
out="$(printf 'protocol=https\nhost=github.com\n\n' | SCOUT_PR_TOKEN="$PR_TOKEN" git -c credential.helper= -c 'credential.helper=!f() { test "$1" = get && printf "username=x-access-token\npassword=%s\n" "$SCOUT_PR_TOKEN"; }; f' credential fill 2>/dev/null)"
check "credential helper supplies the token" 'echo "$out" | grep -q "password=tok_123"'

# empty array under set -u (bash 3.2)
draft=(); x=(a ${draft[@]+"${draft[@]}"} b)
check "empty optional array is safe under set -u" '[ "${#x[@]}" -eq 2 ]'
rm -rf "$T"; exit $fail

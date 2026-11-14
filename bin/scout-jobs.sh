#!/usr/bin/env bash
# The daily scout (standard §7.5) as a LaunchAgent, the same pattern as netinventory's scan-jobs.sh. Each day at the
# set time it:
#   1. brings the long-lived worktree .claude/worktrees/scout-daily (branch scout/daily) up to date with origin/main.
#      The ledger accumulates there.
#   2. runs the scout headless (`claude -p`) with only the tools commands/scout.md allows, private local/ files
#      denied, no git commit/push, and a hard time limit.
#   3. saves the report to local/scout/<date>.md.
#   4. emails the summary when something changed, or a failure notice (bin/scout-mail.py: Keychain SMTP or Mail.app).
#   5. commits the day's ledger + proposals to the local branch scout/daily, then (with the PR token) opens one pull
#      request per proposal: a fresh branch scout/<kind>/<name> from origin/main with the proposal applied and every
#      check run, described with a recommendation (bin/scout-pr.mjs). Plus one records-only PR (scout/ledger).
#      It never pushes to main: you merge (approve), close (reject) or label "hold"; the next run reads that back.
#
# Usage:  bin/scout-jobs.sh start [HH:MM]   install/replace the LaunchAgent (default 07:30, local time)
#         bin/scout-jobs.sh stop            remove it
#         bin/scout-jobs.sh status          is it loaded, when does it run, last log lines
#         bin/scout-jobs.sh logs            follow the log (Ctrl-C to quit)
#         bin/scout-jobs.sh run             run the scout now (what the LaunchAgent runs)
#         bin/scout-jobs.sh set-token       store a read-only GitHub token (else the run is unauthenticated)
#         bin/scout-jobs.sh set-pr-token    store the token that pushes scout/* branches and opens PRs (else no PRs)
#         bin/scout-jobs.sh publish         open PRs for pending proposals now (no agent run)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The LaunchAgent must point at the main checkout, never at a temporary worktree that may be deleted.
KIT="$(cd "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
LABEL="com.engineering-standard.scout"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$KIT/local/scout"
LOG="$LOGDIR/scout.log"
WT="$KIT/.claude/worktrees/scout-daily"
BRANCH="scout/daily"
DOMAIN="gui/$(id -u)"
LIMIT_SECONDS="${SCOUT_LIMIT_SECONDS:-5400}"      # 90 minutes, then the run is killed and reported as failed
# The unattended agent reads untrusted web content and has WebFetch, so it must not reach anything private (AGT-4).
# Reads outside the worktree already need approval, which --permission-mode dontAsk turns into a denial (commands/
# scout.md grants no unscoped Read/Grep/Glob). The denies below are a backstop: owner data inside the worktree,
# credential stores in $HOME, and the commands it must never run (the wrapper, not the agent, sends mail and commits).
DENY="Read(./local/denylist.txt),Read(./local/sites.json),Read(./local/findings/**),Read(./.env),Read(./.env.*),Read(~/.ssh/**),Read(~/.config/**),Read(~/.aws/**),Read(~/.netrc),Read(~/.npmrc),Read(~/Library/**),Bash(git push:*),Bash(git commit:*),Bash(curl:*),Bash(python3:*)"
TOKEN_SERVICE="engineering-standard-github"     # Keychain: a fine-grained, read-only, public-repos token for the scout
PR_TOKEN_SERVICE="engineering-standard-github-pr"   # Keychain: this repo only, Contents + Pull requests write; wrapper only
PWT="$KIT/.claude/worktrees/scout-pr"           # scratch checkout where each proposal is applied on its own branch
PR_TOKEN=""
# File tools refuse anything outside the worktree, in every permission mode (Claude Code ≥ 2.1.257; writes ≥ 2.1.314).
# The run loads only the repo's own (reviewed) project settings — `--setting-sources project` — never your user or
# local settings: a broad user-level allow (bare Edit / Write / Bash) would otherwise widen this agent past its list.
SETTINGS='{"permissions":{"blockReadsOutsideWorkingDirectories":true,"blockWritesOutsideWorkingDirectories":true}}'
MIN_CLAUDE="2.1.257"
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }   # version_ge HAVE NEED

loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

start() {
  local at="${1:-07:30}" hh mm
  [[ "$at" =~ ^([01]?[0-9]|2[0-3]):([0-5][0-9])$ ]] || { echo "time must be HH:MM (24h), got: $at"; exit 1; }
  hh=$((10#${BASH_REMATCH[1]})); mm=$((10#${BASH_REMATCH[2]}))
  stop quiet
  mkdir -p "$(dirname "$PLIST")" "$LOGDIR"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$KIT/bin/scout-jobs.sh</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key><string>$KIT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$hh</integer><key>Minute</key><integer>$mm</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
  launchctl bootstrap "$DOMAIN" "$PLIST"
  printf 'Started %s: daily at %02d:%02d (a missed run happens when the Mac next wakes)\nLog: %s\n' "$LABEL" "$hh" "$mm" "$LOG"
}

stop() {
  local was=""
  if loaded; then launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; was=1; fi
  [ "${1:-}" = quiet ] && return 0
  if [ -n "$was" ]; then echo "Stopped the daily scout."; else echo "The daily scout wasn't scheduled."; fi
}

status() {
  if loaded; then
    echo "LaunchAgent $LABEL: loaded"
    /usr/libexec/PlistBuddy -c 'Print :StartCalendarInterval' "$PLIST" 2>/dev/null | tr -s ' \n' ' ' | sed 's/^/  schedule: /'; echo
  else
    echo "LaunchAgent $LABEL: not loaded (bin/scout-jobs.sh start)"
  fi
  [ -d "$WT" ] && echo "Worktree: $WT ($(git -C "$WT" log -1 --format='%h %cs %s' 2>/dev/null))"
  python3 -I "$HERE/scout-mail.py" status | sed -n '$p' | sed 's/^ */Email /'
  for s in "$TOKEN_SERVICE:read-only API token" "$PR_TOKEN_SERVICE:PR token"; do
    if security find-generic-password -s "${s%%:*}" -a token >/dev/null 2>&1; then echo "${s#*:}: set"; else echo "${s#*:}: not set"; fi
  done
  [ -f "$LOG" ] && { echo "--- last lines of $LOG"; tail -n 8 "$LOG"; }
  return 0
}

mail() {   # mail SUBJECT BODYFILE: never fails the run
  python3 -I "$WT/bin/scout-mail.py" send --subject "$1" --body-file "$2" || echo "email failed (see above)"
}

run() {
  local day; day="$(date +%F)"
  mkdir -p "$LOGDIR"
  echo "=== scout run $day $(date +%T)"
  git -C "$KIT" fetch --quiet origin main
  if [ ! -d "$WT" ]; then
    if git -C "$KIT" show-ref --verify --quiet "refs/heads/$BRANCH"; then git -C "$KIT" worktree add --quiet "$WT" "$BRANCH"
    else git -C "$KIT" worktree add --quiet -b "$BRANCH" "$WT" origin/main; fi
  fi
  local body="$LOGDIR/mail-$day.txt" out="$LOGDIR/claude-$day.txt"
  if ! merge_main; then
    printf 'The daily scout did not run: merging origin/main into %s conflicted outside the ledger and proposals.\nResolve it in %s and re-run: bin/scout-jobs.sh run\n' "$BRANCH" "$WT" > "$body"
    mail "[engineering-standard] Scout $day: NOT RUN (merge conflict)" "$body"; return 1
  fi
  restore_code "before the run" >/dev/null   # the tool list (commands/scout.md) and every script come from main

  # Fail closed: the unattended agent reads untrusted web content and has WebFetch, so the file tools must refuse
  # reads outside the worktree (permissions.blockReadsOutsideWorkingDirectories, Claude Code ≥ MIN_CLAUDE). On an
  # older Claude Code that setting is silently ignored, so the run does not start.
  local ver; ver="$(claude --version 2>/dev/null | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' || echo 0.0.0)"
  if ! version_ge "$ver" "$MIN_CLAUDE"; then
    printf 'The daily scout did not run: Claude Code %s is older than %s, so it cannot keep the unattended agent from\nreading files outside its worktree (permissions.blockReadsOutsideWorkingDirectories).\nUpgrade Claude Code (e.g. brew upgrade claude-code), then: bin/scout-jobs.sh run\n' "$ver" "$MIN_CLAUDE" > "$body"
    echo "not run: Claude Code $ver < $MIN_CLAUDE"
    mail "[engineering-standard] Scout $day: NOT RUN (upgrade Claude Code)" "$body"; return 1
  fi

  # The prompt is the scout command itself (independent of which plugin version is installed).
  local cmd="$WT/commands/scout.md" allowed prompt rc=0
  allowed="$(sed -n 's/^allowed-tools: //p' "$cmd")"
  prompt="$(awk 'f>=2{print} /^---$/{f++}' "$cmd" | sed 's/\$ARGUMENTS//g')"
  prompt="You are running unattended on a schedule: ask nothing, make decisions within the policy, and stop at proposals. The wrapper saves the report, sends the email and commits; skip sending email yourself. The plugin's MCP tools (rules_for, rule, mode) are not loaded in this run: look rules up in build/rules.json and ENGINEERING_STANDARD.md instead.

$prompt"
  # bin/*.mjs send it only to api.github.com, for rate limits; the agent has no shell that could print it.
  # Fail closed: only the scoped read-only token is used. Without it the run is unauthenticated (rate-limited, so
  # discovery and drift may be partial); your full gh login is used only on explicit opt-in (SCOUT_ALLOW_GH_TOKEN=1).
  local token_note=""
  GITHUB_TOKEN="$(security find-generic-password -s "$TOKEN_SERVICE" -a token -w 2>/dev/null || true)"
  if [ -z "$GITHUB_TOKEN" ] && [ "${SCOUT_ALLOW_GH_TOKEN:-}" = 1 ]; then
    GITHUB_TOKEN="$(gh auth token 2>/dev/null || true)"; token_note="Ran with your gh login (SCOUT_ALLOW_GH_TOKEN=1)."
  elif [ -z "$GITHUB_TOKEN" ]; then
    token_note="Ran unauthenticated (no read-only token: bin/scout-jobs.sh set-token), so GitHub rate limits may have cut discovery or drift short."
  fi
  if [ -n "$GITHUB_TOKEN" ]; then export GITHUB_TOKEN; else unset GITHUB_TOKEN; fi
  [ -n "$token_note" ] && echo "note: $token_note"
  # The owner's decisions on yesterday's pull requests (merged / closed / hold) go into the ledger first.
  local slug=""; slug="$(repo_slug)" || true
  [ -n "$slug" ] && { ( cd "$WT" && node bin/scout-pr.mjs sync --repo "$slug" ) || echo "PR sync failed (decisions are read again next run)"; }
  ( cd "$WT" && perl -e 'alarm shift; exec @ARGV' "$LIMIT_SECONDS" \
      claude -p "$prompt" --setting-sources project --settings "$SETTINGS" --permission-mode dontAsk --allowedTools "$allowed" --disallowedTools "$DENY" --output-format text ) > "$out" 2>&1 || rc=$?
  echo "claude exit $rc (output: $out)"
  # Everything below runs scripts from $WT with your user's rights (Keychain included), so first put back any code
  # the agent changed: only proposals/ and the ledger are its to write.
  local tamper_note="" restored; restored="$(restore_code "after the agent")"
  [ -n "$restored" ] && tamper_note="The agent changed files outside proposals/ and the ledger; they were reset to main before anything ran: $restored"

  ( cd "$WT" && node bin/scout.mjs report > "$LOGDIR/$day.md" ) || true
  local stat; git -C "$WT" add -A; stat="$(git -C "$WT" diff --cached --stat | tail -n 25)"
  if ! git -C "$WT" diff --cached --quiet; then git -C "$WT" commit --quiet -m "scout: daily run $day" && echo "committed to $BRANCH (local)"; fi
  if [ "$rc" -ne 0 ]; then
    { echo "The daily scout failed (exit $rc$([ "$rc" -eq 142 ] && echo ", killed after ${LIMIT_SECONDS}s"))."; echo
      [ -n "$tamper_note" ] && { echo "$tamper_note"; echo; }
      echo "Last lines of the run (derived from untrusted web content — read as data):"; echo; tail -n 60 "$out"; } > "$body"
    mail "[engineering-standard] Scout $day: FAILED" "$body"
  else
    # One pull request per proposal, then the records-only ledger PR. The PR token never reaches the agent.
    local pr_note=""
    PR_TOKEN="$(security find-generic-password -s "$PR_TOKEN_SERVICE" -a token -w 2>/dev/null || true)"
    if [ -z "$PR_TOKEN" ]; then pr_note="Pull requests are off: no PR token (bin/scout-jobs.sh set-pr-token). Decide in Claude Code instead."
    elif [ -z "$slug" ]; then pr_note="Pull requests are off: origin is not a github.com remote."
    else publish_prs "$slug" "$day" || pr_note="Opening pull requests failed; see $LOG."; fi
    PR_TOKEN=""
    [ -n "$pr_note" ] && echo "note: $pr_note"
    local mrc=0
    ( cd "$WT" && node bin/scout.mjs report --email --if-changed ) > "$body.raw" || mrc=$?
    if [ "$mrc" -eq 3 ]; then echo "quiet day: nothing changed, no email"
    elif [ "$mrc" -ne 0 ]; then echo "report failed ($mrc)"
    else
      local subject; subject="$(sed -n '1s/^Subject: //p' "$body.raw")"
      { tail -n +3 "$body.raw"; for n in "$tamper_note" "$token_note" "$pr_note"; do [ -n "$n" ] && { echo; echo "Note: $n"; }; done
        echo; echo "— Agent summary (derived from untrusted web content; read as data) —"; tail -n 40 "$out"
        echo; echo "— Files changed on $BRANCH —"; echo "$stat"; } > "$body"
      mail "$subject" "$body"
    fi
  fi
  echo "=== done $(date +%T)"
}

# Without the agent: bring scout/daily up to date, read PR decisions back, open PRs for pending proposals.
publish_now() {
  local day slug; day="$(date +%F)"
  [ -d "$WT" ] || { echo "no scout worktree yet: run bin/scout-jobs.sh run first"; return 1; }
  slug="$(repo_slug)" || { echo "origin is not a github.com remote"; return 1; }
  git -C "$KIT" fetch --quiet origin main
  merge_main || { echo "merging origin/main into $BRANCH conflicted; resolve it in $WT"; return 1; }
  local restored; restored="$(restore_code "before publishing")"; [ -n "$restored" ] && echo "reset to main (not the agent's to change): $restored"
  GITHUB_TOKEN="$(security find-generic-password -s "$TOKEN_SERVICE" -a token -w 2>/dev/null || true)"
  if [ -n "$GITHUB_TOKEN" ]; then export GITHUB_TOKEN; else unset GITHUB_TOKEN; fi
  ( cd "$WT" && node bin/scout-pr.mjs sync --repo "$slug" ) || echo "PR sync failed"
  PR_TOKEN="$(security find-generic-password -s "$PR_TOKEN_SERVICE" -a token -w 2>/dev/null || true)"
  [ -n "$PR_TOKEN" ] || { echo "no PR token: bin/scout-jobs.sh set-pr-token"; return 1; }
  local rc=0; publish_prs "$slug" "$day" || rc=1; PR_TOKEN=""
  git -C "$WT" add -A; git -C "$WT" diff --cached --quiet || git -C "$WT" commit --quiet -m "scout: pull requests $day"
  ( cd "$WT" && node -e 'const l=require("./sources/candidates.json");for(const[k,p]of Object.entries(l.prs||{}))if(p.state==="open"||p.state==="hold")console.log(`${p.url}  ${k}  recommended: ${p.recommendation||"?"}`)' )
  return "$rc"
}

# origin/main into scout/daily. Proposals take main's version (main has the applied ones). The ledger is merged hunk
# by hunk; only where both sides changed the same lines does the scout's (newer) copy win, and the result must still
# be valid JSON. Any other conflict, or a merge that failed for another reason, stops the run.
merge_main() {
  git -C "$WT" merge --quiet --no-edit origin/main >/dev/null 2>&1 && return 0
  if ! ( cd "$WT" && test -f "$(git rev-parse --git-path MERGE_HEAD)" ); then return 1; fi   # not a conflict: nothing to resolve
  local f d bad=0
  while IFS= read -r f; do
    case "$f" in
      sources/candidates.json)
        d="$(mktemp -d)"
        git -C "$WT" show ":1:$f" > "$d/base" 2>/dev/null || echo '{}' > "$d/base"
        git -C "$WT" show ":2:$f" > "$d/ours" && git -C "$WT" show ":3:$f" > "$d/theirs" || bad=1
        git merge-file --ours "$d/ours" "$d/base" "$d/theirs" >/dev/null 2>&1
        if [ "$bad" -eq 0 ] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$d/ours" 2>/dev/null; then
          cp "$d/ours" "$WT/$f" && git -C "$WT" add -- "$f"
        else bad=1; fi
        rm -rf "$d" ;;
      proposals/*) git -C "$WT" checkout --theirs -- "$f" && git -C "$WT" add -- "$f" ;;
      *) bad=1 ;;
    esac
  done < <(git -C "$WT" diff --name-only --diff-filter=U)
  if [ "$bad" -eq 0 ] && git -C "$WT" commit --quiet --no-edit; then echo "merged origin/main (ledger merged by hunk, proposals from main)"; return 0; fi
  git -C "$WT" merge --abort 2>/dev/null || true; return 1
}

# The wrapper runs scripts from $WT (scout-pr.mjs, scout.mjs, scout-mail.py) and reads the agent's tool list from
# $WT/commands/scout.md. The agent may write only proposals/ and the ledger (and git-ignored local/), so anything
# else that differs from origin/main, tracked, untracked or ignored, is put back before any of it runs. Prints the
# paths it reset (nothing when clean).
DATA_PATHS=(':(exclude)proposals' ':(exclude)sources/candidates.json' ':(exclude)local')
restore_code() {   # restore_code WHEN
  local changed
  changed="$( { git -C "$WT" diff --name-only origin/main -- . "${DATA_PATHS[@]}"
                git -C "$WT" ls-files --others -- . "${DATA_PATHS[@]}"; } | sort -u | head -n 50 | tr '\n' ' ')"
  [ -n "$changed" ] || return 0
  git -C "$WT" restore --source=origin/main --staged --worktree -- . "${DATA_PATHS[@]}" 2>/dev/null
  git -C "$WT" clean -fdxq -- . "${DATA_PATHS[@]}"
  echo "restore_code ($1): reset $changed" >&2
  echo "$changed"
}

repo_slug() {   # owner/name of a github.com origin, else fail
  local u; u="$(git -C "$KIT" remote get-url origin 2>/dev/null)" || return 1
  [[ "$u" =~ ^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$ ]] || return 1
  echo "${BASH_REMATCH[2]%.git}"
}

# The PR token goes to git (through a one-shot credential helper reading it from the environment, never argv) and to
# gh (GH_TOKEN), and to nothing else. Pushes always go to the https URL, so an ssh origin can't swap in your ssh key,
# and only to a scout/* branch.
SCOUT_BRANCH='^scout/((source|standard)/[a-z0-9][a-z0-9-]{0,80}|ledger)$'
git_push() {   # git_push DIR SLUG BRANCH
  [[ "$3" =~ $SCOUT_BRANCH ]] || { echo "refusing to push $3"; return 1; }
  SCOUT_PR_TOKEN="$PR_TOKEN" git -C "$1" -c credential.helper= \
    -c 'credential.helper=!f() { test "$1" = get && printf "username=x-access-token\npassword=%s\n" "$SCOUT_PR_TOKEN"; }; f' \
    push --quiet --force "https://github.com/$2.git" "HEAD:refs/heads/$3"
}
ghp() { GH_TOKEN="$PR_TOKEN" gh "$@"; }
own_pr() {   # own_pr SLUG BRANCH → number of the open same-repo PR for BRANCH (a fork can reuse the branch name)
  ghp pr list --repo "$1" --head "$2" --state open --json number,isCrossRepository --jq '[.[] | select(.isCrossRepository | not)][0].number // empty'
}

pr_worktree() {   # a clean checkout of origin/main on branch $1, rebuilt every time (scout/* branches are the scout's)
  git -C "$KIT" worktree remove --force "$PWT" 2>/dev/null || true
  git -C "$KIT" worktree prune
  git -C "$KIT" worktree add --quiet --force -B "$1" "$PWT" origin/main
}

open_pr() {   # open_pr SLUG BRANCH TITLE BODYFILE REC → prints "number url"
  local slug="$1" branch="$2" title="$3" bodyf="$4" rec="$5" num
  [ -n "$title" ] && [ -s "$bodyf" ] || { echo "empty PR title or body" >&2; return 1; }
  git_push "$PWT" "$slug" "$branch" >&2 || return 1
  num="$(own_pr "$slug" "$branch")" || return 1
  if [ -n "$num" ]; then ghp pr edit "$num" --repo "$slug" --title "$title" --body-file "$bodyf" >/dev/null || return 1
  else
    local draft=(); [ "$rec" = reject ] && draft=(--draft)
    ghp pr create --repo "$slug" --base main --head "$branch" --title "$title" --body-file "$bodyf" --label scout ${draft[@]+"${draft[@]}"} >/dev/null || return 1
    num="$(own_pr "$slug" "$branch")" || return 1; [ -n "$num" ] || return 1
  fi
  ghp pr view "$num" --repo "$slug" --json number,url --jq '"\(.number) \(.url)"'
}

# Scan what is about to go public (the branch's changes plus the PR title and description) with check-public.
public_ok() {   # public_ok TITLE BODYFILE LOG
  local f="$PWT/.scout-pr-text.md"
  { printf '%s\n\n' "$1"; cat "$2"; } > "$f"; git -C "$PWT" add -f -- "$f"
  local rc=0; ( cd "$PWT" && node bin/check-public.mjs --staged ) >> "$3" 2>&1 || rc=1
  git -C "$PWT" rm -q --cached -- "$f" >/dev/null 2>&1; rm -f "$f"
  return "$rc"
}

publish_one() {   # publish_one SLUG KIND NAME: apply on a fresh branch from main, check, open or update its PR
  local slug="$1" kind="$2" name="$3" branch="scout/$2/$3" checks="$LOGDIR/pr-$3.checks" log="$LOGDIR/pr-$3.log" r
  [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,80}$ ]] || { echo "skip: bad proposal name $name"; return 1; }
  pr_worktree "$branch" || return 1
  : > "$checks"; : > "$log"
  if [ "$kind" = source ]; then
    cp "$WT/proposals/sources/$name.md" "$WT/proposals/sources/$name.rules.json" "$PWT/proposals/sources/" || return 1
    if [ -f "$WT/local/consume/$name/inventory.json" ]; then mkdir -p "$PWT/local/consume/$name"; cp "$WT/local/consume/$name/inventory.json" "$PWT/local/consume/$name/"; fi
    ( cd "$PWT" && perl -e 'alarm shift; exec @ARGV' 300 node bin/consume.mjs apply "$name" ) >> "$log" 2>&1 && r=ok || r=fail
  else
    mkdir -p "$PWT/proposals/standards"; cp "$WT/proposals/standards/$name.json" "$PWT/proposals/standards/" || return 1
    ( cd "$PWT" && perl -e 'alarm shift; exec @ARGV' 300 node bin/scout-pr.mjs apply-standard "$name" ) >> "$log" 2>&1 && r=ok || r=fail
  fi
  # A proposal that doesn't apply cleanly (or fails check-public) is never pushed: the email reports it instead.
  [ "$r" = ok ] || { echo "$kind $name: apply or its checks failed; not pushed (see $log)"; return 1; }
  printf 'apply + repo checks (build-rules, similar, sources, check-public)\tok\n' >> "$checks"
  ( cd "$PWT" && node bin/scout.mjs --check ) >> "$log" 2>&1 && r=ok || r=fail; printf 'scout.mjs --check\t%s\n' "$r" >> "$checks"
  local t; t="$( cd "$PWT" && perl -e 'alarm shift; exec @ARGV' 600 node plugin/test/run.mjs --offline 2>&1 | tail -n 1 )"; echo "$t" >> "$log"
  [[ "$t" =~ ([0-9]+)\ passed,\ 0\ failed ]] && r=ok || r=fail; printf 'plugin self-tests (%s)\t%s\n' "${t%% (*}" "$r" >> "$checks"
  if command -v semgrep >/dev/null; then ( cd "$PWT" && semgrep --test semgrep/ ) >> "$log" 2>&1 && r=ok || r=fail; printf 'semgrep rule tests\t%s\n' "$r" >> "$checks"; fi
  git -C "$PWT" add -A
  git -C "$PWT" diff --cached --quiet && { echo "$kind $name: applying changed nothing; no PR"; return 0; }
  local title rec bodyf="$LOGDIR/pr-$name.md" pr
  title="$( cd "$WT" && node bin/scout-pr.mjs title "$kind" "$name" )" || return 1
  rec="$( cd "$WT" && node bin/scout-pr.mjs recommend "$kind" "$name" --checks "$checks" )" || return 1
  ( cd "$WT" && node bin/scout-pr.mjs body "$kind" "$name" --checks "$checks" ) > "$bodyf" || return 1
  public_ok "$title" "$bodyf" "$log" || { echo "$kind $name: check-public flagged the change or PR text; not pushed (see $log)"; return 1; }
  git -C "$PWT" commit --quiet -m "$title" || return 1
  pr="$(open_pr "$slug" "$branch" "$title" "$bodyf" "$rec")" || { echo "$kind $name: opening the PR failed"; return 1; }
  ( cd "$WT" && node bin/scout-pr.mjs record "$kind:$name" --number "${pr%% *}" --url "${pr#* }" --branch "$branch" --rec "$rec" ) || return 1
}

publish_prs() {   # publish_prs SLUG DAY
  local slug="$1" day="$2" kind name failed=0 f n=0 names=""
  ghp label create scout --color 0E8A16 --description "Opened by the daily scout" >/dev/null 2>&1 || true
  ghp label create "hold" --color FBCA04 --description "Scout: keep watching, re-check later" >/dev/null 2>&1 || true
  while read -r kind name; do
    [ -n "$kind" ] || continue
    publish_one "$slug" "$kind" "$name" < /dev/null || failed=1
  done < <(cd "$WT" && node bin/scout-pr.mjs pending)
  git -C "$WT" add -A
  git -C "$WT" diff --cached --quiet || git -C "$WT" commit --quiet -m "scout: pull requests $day"
  # The records-only ledger PR, rebuilt from main each run: the ledger and the intake reviews, never rule changes.
  local files=()
  while IFS= read -r -d '' f; do files[n]="$f"; n=$((n + 1)); names="$names${names:+,}$f"; done \
    < <(git -C "$WT" diff -z --name-only --diff-filter=AM origin/main HEAD -- sources/candidates.json 'proposals/sources/*.md')
  if [ "$n" -gt 0 ]; then
    local log="$LOGDIR/pr-ledger.log"; : > "$log"
    if pr_worktree "scout/ledger" && git -C "$PWT" checkout "$BRANCH" -- "${files[@]}"; then
      git -C "$PWT" show origin/main:sources/candidates.json > "$LOGDIR/ledger-base.json" 2>/dev/null || echo '{"candidates":[]}' > "$LOGDIR/ledger-base.json"
      git -C "$PWT" add -A
      if ( cd "$WT" && node bin/scout-pr.mjs body ledger --base "$LOGDIR/ledger-base.json" --files "$names" ) > "$LOGDIR/pr-ledger.md" \
         && ( cd "$PWT" && node bin/scout.mjs --check ) >> "$log" 2>&1 \
         && public_ok "Scout ledger: records only (no rule changes)" "$LOGDIR/pr-ledger.md" "$log" \
         && git -C "$PWT" commit --quiet -m "scout: ledger $day"; then
        open_pr "$slug" "scout/ledger" "Scout ledger: records only (no rule changes)" "$LOGDIR/pr-ledger.md" approve >/dev/null || failed=1
      else echo "ledger PR: checks failed; not pushed (see $log)"; failed=1; fi
    else failed=1; fi
  fi
  git -C "$KIT" worktree remove --force "$PWT" 2>/dev/null || true
  return "$failed"
}

# Store a fine-grained GitHub token (public repositories, read-only, no other permissions) for the scout's API
# calls, so the unattended run never carries your full gh login. The secret goes to `security` on stdin, not argv.
set_token() {
  # GitHub has no API for minting fine-grained tokens, so open its pre-filled form: no repository access and no
  # permissions = read-only on public repos, which is all the scout needs. Expires after 366 days (the maximum).
  local tok url="https://github.com/settings/personal-access-tokens/new?name=engineering-standard+scout&description=Daily+scout%3A+read-only+public+repo+metadata.+No+permissions.&expires_in=366"
  echo "Create the token here (leave Repository access on 'Public repositories', grant no permissions):"
  echo "  $url"
  command -v open >/dev/null && open "$url"
  read -r -s -p "Fine-grained GitHub token (public repos, read-only): " tok; echo
  store_token "$TOKEN_SERVICE" "engineering-standard scout github" "$tok"
}
store_token() {   # store_token SERVICE LABEL TOKEN: to `security` on stdin, never argv
  [ -n "$3" ] || { echo "aborted: empty"; return 1; }
  [[ "$3" =~ ^[A-Za-z0-9_]+$ ]] || { echo "aborted: that doesn't look like a GitHub token"; return 1; }
  printf 'add-generic-password -U -s "%s" -a token -l "%s" -w "%s"\n' "$1" "$2" "$3" | security -i >/dev/null
  echo "saved in the Keychain ($1)"
}
# The token the WRAPPER uses to push scout/* branches and open PRs: this repository only, Contents and Pull
# requests read/write, nothing else. The agent never sees it (it is read after the agent exits).
set_pr_token() {
  local tok slug owner; slug="$(repo_slug)" || { echo "origin is not a github.com remote"; return 1; }; owner="${slug%%/*}"
  local url="https://github.com/settings/personal-access-tokens/new?name=engineering-standard+scout+PRs&description=Daily+scout%3A+push+scout%2F*+branches+and+open+PRs+on+${slug/\//%2F}+only.&target_name=$owner&expires_in=366&contents=write&pull_requests=write"
  echo "Create the token here. Repository access: 'Only select repositories' → ${slug#*/}."
  echo "Permissions: Contents = Read and write, Pull requests = Read and write (Metadata read is automatic). Nothing else."
  echo "  $url"
  command -v open >/dev/null && open "$url"
  read -r -s -p "Fine-grained GitHub token for PRs: " tok; echo
  store_token "$PR_TOKEN_SERVICE" "engineering-standard scout PRs" "$tok" || return 1
  # Prove it can see the repo; never print the token.
  if GH_TOKEN="$tok" gh api "repos/$slug" --jq '.permissions.push' 2>/dev/null | grep -q true; then echo "verified: the token can push to $slug"
  else echo "warning: the token cannot push to $slug yet; check its repository access and permissions"; fi
}

[ "${BASH_SOURCE[0]}" != "$0" ] && return 0     # sourced (the self-tests): define the functions only
case "${1:-}" in
  set-token) set_token ;;
  set-pr-token) set_pr_token ;;
  publish) publish_now ;;
  start)  shift; start "$@" ;;
  stop)   stop ;;
  status) status ;;
  logs)   mkdir -p "$LOGDIR"; touch "$LOG"; tail -f "$LOG" ;;
  run)    run ;;
  *)      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

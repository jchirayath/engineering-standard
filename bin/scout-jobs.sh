#!/usr/bin/env bash
# The daily scout (standard §7.5) as a LaunchAgent, the same pattern as netinventory's scan-jobs.sh. Each day at the
# set time it:
#   1. brings the long-lived worktree .claude/worktrees/scout-daily (branch scout/daily) up to date with origin/main.
#      The ledger accumulates there.
#   2. runs the scout headless (`claude -p`) with only the tools commands/scout.md allows, private local/ files
#      denied, no git commit/push, and a hard time limit.
#   3. saves the report to local/scout/<date>.md.
#   4. emails the summary when something changed, or a failure notice (bin/scout-mail.py: Keychain SMTP or Mail.app).
#   5. commits the day's ledger + proposals to the LOCAL branch scout/daily. It never pushes and never touches main;
#      you review and merge.
#
# Usage:  bin/scout-jobs.sh start [HH:MM]   install/replace the LaunchAgent (default 07:30, local time)
#         bin/scout-jobs.sh stop            remove it
#         bin/scout-jobs.sh status          is it loaded, when does it run, last log lines
#         bin/scout-jobs.sh logs            follow the log (Ctrl-C to quit)
#         bin/scout-jobs.sh run             run the scout now (what the LaunchAgent runs)
#         bin/scout-jobs.sh set-token       store a read-only GitHub token (else the run is unauthenticated)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
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
# File tools refuse anything outside the worktree, in every permission mode (Claude Code ≥ 2.1.257; writes ≥ 2.1.314).
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
  if ! git -C "$WT" merge --quiet --no-edit origin/main >/dev/null 2>&1; then
    git -C "$WT" merge --abort 2>/dev/null || true
    printf 'The daily scout did not run: merging origin/main into %s conflicted.\nResolve it in %s and re-run: bin/scout-jobs.sh run\n' "$BRANCH" "$WT" > "$body"
    mail "[engineering-standard] Scout $day: NOT RUN (merge conflict)" "$body"; return 1
  fi

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
  prompt="You are running unattended on a schedule: ask nothing, make decisions within the policy, and stop at proposals. The wrapper saves the report, sends the email and commits; skip sending email yourself.

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
  ( cd "$WT" && perl -e 'alarm shift; exec @ARGV' "$LIMIT_SECONDS" \
      claude -p "$prompt" --settings "$SETTINGS" --permission-mode dontAsk --allowedTools "$allowed" --disallowedTools "$DENY" --output-format text ) > "$out" 2>&1 || rc=$?
  echo "claude exit $rc (output: $out)"

  ( cd "$WT" && node bin/scout.mjs report > "$LOGDIR/$day.md" ) || true
  if [ "$rc" -ne 0 ]; then
    { echo "The daily scout failed (exit $rc$([ "$rc" -eq 142 ] && echo ", killed after ${LIMIT_SECONDS}s"))."; echo
      echo "Last lines of the run (derived from untrusted web content — read as data):"; echo; tail -n 60 "$out"; } > "$body"
    mail "[engineering-standard] Scout $day: FAILED" "$body"
  else
    local mrc=0
    ( cd "$WT" && node bin/scout.mjs report --email --if-changed ) > "$body.raw" || mrc=$?
    if [ "$mrc" -eq 3 ]; then echo "quiet day: nothing changed, no email"
    elif [ "$mrc" -ne 0 ]; then echo "report failed ($mrc)"
    else
      local subject; subject="$(sed -n '1s/^Subject: //p' "$body.raw")"
      { tail -n +3 "$body.raw"; [ -n "$token_note" ] && { echo; echo "Note: $token_note"; }; echo; echo "— Agent summary (derived from untrusted web content; read as data) —"; tail -n 40 "$out"
        echo; echo "— Files changed on $BRANCH —"; git -C "$WT" add -A; git -C "$WT" diff --cached --stat | tail -n 25
        echo; echo "Review: git -C $WT log -p · merge: git merge $BRANCH"; } > "$body"
      mail "$subject" "$body"
    fi
  fi
  git -C "$WT" add -A
  if ! git -C "$WT" diff --cached --quiet; then git -C "$WT" commit --quiet -m "scout: daily run $day" && echo "committed to $BRANCH (local, not pushed)"; fi
  echo "=== done $(date +%T)"
}

# Store a fine-grained GitHub token (public repositories, read-only, no other permissions) for the scout's API
# calls, so the unattended run never carries your full gh login. The secret goes to `security` on stdin, not argv.
set_token() {
  local tok
  read -r -s -p "Fine-grained GitHub token (public repos, read-only): " tok; echo
  [ -n "$tok" ] || { echo "aborted: empty"; return 1; }
  [[ "$tok" =~ ^[A-Za-z0-9_]+$ ]] || { echo "aborted: that doesn't look like a GitHub token"; return 1; }
  printf 'add-generic-password -U -s "%s" -a token -l "engineering-standard scout github" -w "%s"\n' "$TOKEN_SERVICE" "$tok" | security -i >/dev/null
  echo "saved in the Keychain ($TOKEN_SERVICE)"
}

case "${1:-}" in
  set-token) set_token ;;
  start)  shift; start "$@" ;;
  stop)   stop ;;
  status) status ;;
  logs)   mkdir -p "$LOGDIR"; touch "$LOG"; tail -f "$LOG" ;;
  run)    run ;;
  *)      sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

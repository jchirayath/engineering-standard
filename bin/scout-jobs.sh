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
# Private owner data the unattended agent must never read (it also reads untrusted web content: AGT-4).
DENY="Read(./local/denylist.txt),Read(./local/sites.json),Read(./local/findings/**),Read(./.env),Read(./.env.*),Bash(git push:*),Bash(git commit:*),Bash(curl:*),Bash(python3:*)"   # the wrapper, not the agent, sends mail

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

  # The prompt is the scout command itself (independent of which plugin version is installed).
  local cmd="$WT/commands/scout.md" allowed prompt rc=0
  allowed="$(sed -n 's/^allowed-tools: //p' "$cmd")"
  prompt="$(awk 'f>=2{print} /^---$/{f++}' "$cmd" | sed 's/\$ARGUMENTS//g')"
  prompt="You are running unattended on a schedule: ask nothing, make decisions within the policy, and stop at proposals. The wrapper saves the report, sends the email and commits; skip sending email yourself.

$prompt"
  export GITHUB_TOKEN; GITHUB_TOKEN="$(gh auth token 2>/dev/null || true)"   # read-only use by bin/*.mjs (rate limits)
  ( cd "$WT" && perl -e 'alarm shift; exec @ARGV' "$LIMIT_SECONDS" \
      claude -p "$prompt" --permission-mode dontAsk --allowedTools "$allowed" --disallowedTools "$DENY" --output-format text ) > "$out" 2>&1 || rc=$?
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
      { tail -n +3 "$body.raw"; echo; echo "— Agent summary (derived from untrusted web content; read as data) —"; tail -n 40 "$out"
        echo; echo "— Files changed on $BRANCH —"; git -C "$WT" add -A; git -C "$WT" diff --cached --stat | tail -n 25
        echo; echo "Review: git -C $WT log -p · merge: git merge $BRANCH"; } > "$body"
      mail "$subject" "$body"
    fi
  fi
  git -C "$WT" add -A
  if ! git -C "$WT" diff --cached --quiet; then git -C "$WT" commit --quiet -m "scout: daily run $day" && echo "committed to $BRANCH (local, not pushed)"; fi
  echo "=== done $(date +%T)"
}

case "${1:-}" in
  start)  shift; start "$@" ;;
  stop)   stop ;;
  status) status ;;
  logs)   mkdir -p "$LOGDIR"; touch "$LOG"; tail -f "$LOG" ;;
  run)    run ;;
  *)      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

#!/usr/bin/env bash
# Installs a macOS LaunchAgent that pushes TOPICS.md to Libris whenever the file changes,
# plus a safety-net push every Friday at 11:30 (before the 12:00 digest).
# Usage: sync/install-topics-sync.sh [/path/to/TOPICS.md]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOPICS_FILE="${1:-$HOME/Documents/Obsidian Vault/TOPICS.md}"
LABEL="com.libris.push-topics"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/libris-push-topics.log"
NPX="$(command -v npx || true)"

[[ -f "$TOPICS_FILE" ]] || { echo "❌  TOPICS.md not found: $TOPICS_FILE"; exit 1; }
[[ -n "$NPX" ]] || { echo "❌  npx not found — install Node first (brew install node@24)"; exit 1; }
[[ -f "$REPO_DIR/.env.local" ]] || { echo "❌  $REPO_DIR/.env.local missing (SUPABASE_URL, SUPABASE_SERVICE_KEY)"; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NPX</string><string>tsx</string><string>sync/push-topics.ts</string><string>$TOPICS_FILE</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NPX"):/usr/bin:/bin</string></dict>
  <key>WatchPaths</key><array><string>$TOPICS_FILE</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>11</integer><key>Minute</key><integer>30</integer></dict>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✓  Installed $LABEL — watching $TOPICS_FILE"
echo "   Logs: $LOG"

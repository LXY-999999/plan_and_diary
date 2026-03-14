#!/bin/zsh
set -euo pipefail

REPO_DIR="/Users/luxiaoyue/.openclaw/workspace/plan_and_diary"
DATA_DIR="$REPO_DIR/data/lxy"
PLAN_DIR="$DATA_DIR/plan"
DIARY_DIR="$DATA_DIR/diary"
STAMP="$(date +%F)"
LOG_DIR="$REPO_DIR/logs"
LOG_FILE="$LOG_DIR/backup-plan-diary.log"

mkdir -p "$PLAN_DIR" "$DIARY_DIR" "$LOG_DIR"

cd "$REPO_DIR"

# Keep directory structure committed even before the app starts writing exports.
: > "$PLAN_DIR/.gitkeep"
: > "$DIARY_DIR/.gitkeep"

if git diff --quiet -- "$DATA_DIR" && git diff --cached --quiet -- "$DATA_DIR"; then
  echo "[$(date '+%F %T')] no backup changes under $DATA_DIR" >> "$LOG_FILE"
  exit 0
fi

git add "$DATA_DIR"
if git diff --cached --quiet; then
  echo "[$(date '+%F %T')] nothing staged after add" >> "$LOG_FILE"
  exit 0
fi

git commit -m "backup: plan & diary $STAMP" >> "$LOG_FILE" 2>&1 || {
  echo "[$(date '+%F %T')] commit failed" >> "$LOG_FILE"
  exit 1
}

git push origin main >> "$LOG_FILE" 2>&1 || {
  echo "[$(date '+%F %T')] push failed" >> "$LOG_FILE"
  exit 1
}

echo "[$(date '+%F %T')] backup pushed successfully" >> "$LOG_FILE"

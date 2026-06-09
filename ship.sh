#!/usr/bin/env bash
#
# ship.sh — turn the current working changes into a merged PR in one command.
#
#   ./ship.sh "what I shipped"
#   ./ship.sh "what I shipped" 0x<stream-id>   # route the extension to a specific stream
#
# Flow: branch off main → commit all changes → push → open PR → enable
# auto-merge. CI runs on the PR; once it passes (and any branch-protection
# rules are satisfied) GitHub merges automatically, which fires the CronStream
# webhook and extends the stream.
#
# Pass a stream id as the 2nd argument to embed a
#   CronStream-Stream-Id: 0x…
# line in the PR body, which routes the verified extension to that exact stream
# (useful when several streams watch the same repo).
#
# Requirements:
#   - git remote 'origin' points at the repo
#   - GitHub CLI installed and authenticated:  gh auth status
#   - your authenticated account has push access to the repo
#
set -euo pipefail

MSG="${1:-}"
STREAM_ID="${2:-}"
if [ -z "$MSG" ]; then
  echo "Usage: ./ship.sh \"commit message\" [0x<stream-id>]" >&2
  exit 1
fi
if [ -n "$STREAM_ID" ] && ! [[ "$STREAM_ID" =~ ^0x[a-fA-F0-9]{64}$ ]]; then
  echo "✗ Stream id must be 0x followed by 64 hex chars." >&2
  exit 1
fi

# Must be authenticated with gh.
if ! gh auth status >/dev/null 2>&1; then
  echo "✗ GitHub CLI not authenticated. Run: gh auth login" >&2
  exit 1
fi

# Bail if there's nothing to ship.
if git diff --quiet && git diff --cached --quiet; then
  echo "✗ No changes to ship (working tree clean)." >&2
  exit 1
fi

DEFAULT_BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || echo main)"
BRANCH="ship/$(date +%Y%m%d-%H%M%S)"

echo "→ Branching $BRANCH off $DEFAULT_BRANCH"
git fetch origin "$DEFAULT_BRANCH" --quiet
git checkout -b "$BRANCH"

echo "→ Committing"
git add -A
git commit -m "$MSG"

echo "→ Pushing"
git push -u origin "$BRANCH" --quiet

echo "→ Opening PR"
if [ -n "$STREAM_ID" ]; then
  gh pr create --base "$DEFAULT_BRANCH" --head "$BRANCH" --title "$MSG" \
    --body "$MSG"$'\n\n'"CronStream-Stream-Id: $STREAM_ID"
  echo "  ↳ routing extension to stream $STREAM_ID"
else
  gh pr create --base "$DEFAULT_BRANCH" --head "$BRANCH" --title "$MSG" --fill
fi

echo "→ Enabling auto-merge"
# --auto merges as soon as required checks/reviews pass. If auto-merge isn't
# enabled on the repo, fall back to an immediate merge attempt.
gh pr merge --merge --auto || gh pr merge --merge

echo "✓ Shipped. Returning to $DEFAULT_BRANCH"
git checkout "$DEFAULT_BRANCH" --quiet
git pull origin "$DEFAULT_BRANCH" --quiet || true

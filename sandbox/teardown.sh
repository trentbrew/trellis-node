#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Trellis Sandbox Teardown
#
# Completely removes the sandbox workspace and optionally restores
# the global profile from backup.
#
#   ./sandbox/teardown.sh [--restore-profile]
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_DIR="$SCRIPT_DIR/workspace"

RESTORE_PROFILE=false
for arg in "$@"; do
  case "$arg" in
    --restore-profile) RESTORE_PROFILE=true ;;
  esac
done

if [ -d "$SANDBOX_DIR" ]; then
  rm -rf "$SANDBOX_DIR"
  echo "✓ Sandbox workspace removed"
else
  echo "  (no sandbox workspace to clean)"
fi

if [ "$RESTORE_PROFILE" = true ]; then
  PROFILE_BAK="$HOME/.trellis/profile.json.bak"
  PROFILE="$HOME/.trellis/profile.json"
  if [ -f "$PROFILE_BAK" ]; then
    mv "$PROFILE_BAK" "$PROFILE"
    echo "✓ Profile restored from backup"
  else
    echo "  (no profile backup found)"
  fi
fi

echo ""
echo "✓ Sandbox cleaned up"

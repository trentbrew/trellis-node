#!/usr/bin/env bash
# Shared Trellis CLI helpers for harness hooks.
#
# TRELLIS_VCS_ROOT  — repo path passed to trellis -p (default: .)
#                     Set to fractal-playground when playground TRL issues
#                     live in a nested .trellis.
# TRELLIS_LANE_ID   — VCS lane uuid; subprocess agents auto-enter via syncEnvLaneFromEnv.
#                     With lanes.worktreeBind in .trellis/config.json, edit files under
#                     the lane worktree (see trellis_harness_lane_worktree).
# TRELLIS_DEBUG     — when set, print trellis stderr on failure

trellis_harness_vcs_path() {
  echo "${TRELLIS_VCS_ROOT:-.}"
}

# Resolve lane git worktree path from TRELLIS_LANE_ID (or arg). Empty if unbound.
trellis_harness_lane_worktree() {
  local lane_id="${1:-${TRELLIS_LANE_ID:-}}" path meta
  [ -n "$lane_id" ] || return 1
  path=$(trellis_harness_vcs_path)
  meta="${path}/.trellis/lanes/${lane_id}/meta.json"
  [ -f "$meta" ] || return 1
  if command -v jq >/dev/null 2>&1; then
    jq -r '.worktreePath // empty' "$meta"
  else
    grep -o '"worktreePath"[[:space:]]*:[[:space:]]*"[^"]*"' "$meta" \
      | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
  fi
}

# Preferred cwd for file edits: lane worktree when bound, else repo root.
trellis_harness_edit_root() {
  local wt
  wt=$(trellis_harness_lane_worktree) || true
  if [ -n "$wt" ] && [ -d "$wt" ]; then
    echo "$wt"
  else
    trellis_harness_vcs_path
  fi
}

trellis_harness_debug() {
  [ -n "${TRELLIS_DEBUG:-}" ]
}

# Run trellis; print stdout on success. Returns 1 on failure (stderr to debug only).
trellis_harness_capture() {
  local stdout stderr
  stdout=$(mktemp "${TMPDIR:-/tmp}/trellis-harness-out.XXXXXX") || return 1
  stderr=$(mktemp "${TMPDIR:-/tmp}/trellis-harness-err.XXXXXX") || {
    rm -f "$stdout"
    return 1
  }

  if trellis "$@" >"$stdout" 2>"$stderr"; then
    cat "$stdout"
    rm -f "$stdout" "$stderr"
    return 0
  fi

  if trellis_harness_debug; then
    echo "trellis $* failed" >&2
    sed 's/^/  /' "$stderr" >&2
  fi
  rm -f "$stdout" "$stderr"
  return 1
}

# Count in_progress issues via `trellis issue active` (not --status active).
trellis_harness_active_issue_count() {
  local path out count
  path=$(trellis_harness_vcs_path)
  if ! out=$(trellis_harness_capture issue active -p "$path"); then
    echo 0
    return 0
  fi
  count=$(sed -n 's/^Active Issues (\([0-9][0-9]*\)).*/\1/p' <<<"$out")
  echo "${count:-0}"
}

# Minimal JSON for gemini hook consumers (no --format json in CLI today).
trellis_harness_active_issues_json() {
  local count
  count=$(trellis_harness_active_issue_count)
  echo "{\"count\":${count},\"status\":\"in_progress\"}"
}

# Recent op-log lines from `trellis log -n N`.
trellis_harness_recent_log_count() {
  local path limit="${1:-3}" out
  path=$(trellis_harness_vcs_path)
  if ! out=$(trellis_harness_capture log -n "$limit" -p "$path"); then
    echo 0
    return 0
  fi
  local n
  n=$(grep -cE '^[[:space:]]*(trellis:op:|~mod|→branch|vcs:|\+add|-del)' <<<"$out" 2>/dev/null || true)
  echo "${n:-0}"
}

trellis_harness_recent_log_json() {
  local count
  count=$(trellis_harness_recent_log_count 3)
  echo "{\"count\":${count}}"
}

trellis_harness_strip_ansi() {
  sed 's/\x1b\[[0-9;]*m//g'
}

trellis_harness_issue_show_raw() {
  local id="$1"
  trellis_harness_capture issue show "$id" -p "$(trellis_harness_vcs_path)"
}

trellis_harness_issue_parse_title() {
  local id="$1" out
  out=$(trellis_harness_issue_show_raw "$id") || return 1
  trellis_harness_strip_ansi <<<"$out" | head -1 | sed 's/^TRL-[0-9]*: //'
}

trellis_harness_issue_parse_labels() {
  local id="$1" out
  out=$(trellis_harness_issue_show_raw "$id") || return 1
  trellis_harness_strip_ansi <<<"$out" | sed -n 's/^  Labels:    //p'
}

trellis_harness_issue_has_label() {
  local id="$1" label="$2" labels
  labels=$(trellis_harness_issue_parse_labels "$id") || return 1
  [[ ",${labels// /,}," == *",${label},"* ]]
}

trellis_harness_issue_parse_id_from_create() {
  local out="$1" id
  id=$(trellis_harness_strip_ansi <<<"$out" | grep -oE 'TRL-[0-9]+' | head -1)
  echo "${id:-}"
}

# Create issue; prints new TRL id on stdout.
trellis_harness_issue_create() {
  local title="$1" labels="$2" desc="$3" parent="${4:-}" status="${5:-queue}"
  local path out id
  path=$(trellis_harness_vcs_path)
  local args=(issue create -t "$title" -l "$labels" -d "$desc" -S "$status" -p "$path")
  if [ -n "$parent" ]; then
    args+=(--parent "$parent")
  fi
  if ! out=$(trellis_harness_capture "${args[@]}"); then
    return 1
  fi
  id=$(trellis_harness_issue_parse_id_from_create "$out")
  if [ -z "$id" ]; then
    return 1
  fi
  echo "$id"
}

trellis_harness_issue_set_description() {
  local id="$1" body="$2"
  local clipped="${body:0:8000}"
  trellis_harness_capture issue describe "$id" "$clipped" -p "$(trellis_harness_vcs_path)" >/dev/null
}

trellis_harness_issue_update_labels() {
  local id="$1" labels="$2"
  trellis_harness_capture issue update "$id" -l "$labels" -p "$(trellis_harness_vcs_path)" >/dev/null
}

trellis_harness_issue_update_priority() {
  local id="$1" priority="$2"
  trellis_harness_capture issue update "$id" -P "$priority" -p "$(trellis_harness_vcs_path)" >/dev/null
}

trellis_harness_issue_block() {
  local id="$1" blocked_by="$2"
  trellis_harness_capture issue block "$id" "$blocked_by" -p "$(trellis_harness_vcs_path)" >/dev/null
}

trellis_harness_merge_labels() {
  local existing="$1" add="$2"
  local merged="$existing"
  local part
  IFS=',' read -ra NEW <<<"$add"
  for part in "${NEW[@]}"; do
    part="${part// /}"
    [ -z "$part" ] && continue
    if [ -z "$merged" ]; then
      merged="$part"
    elif [[ ",${merged}," != *",${part},"* ]]; then
      merged="${merged},${part}"
    fi
  done
  echo "$merged"
}

trellis_harness_latest_milestone_name() {
  local out line
  if ! out=$(trellis_harness_capture milestone list -p "$(trellis_harness_vcs_path)"); then
    echo "none"
    return 0
  fi
  line=$(trellis_harness_strip_ansi <<<"$out" | sed -n 's/^[[:space:]]*★ //p' | head -1)
  if [ -z "$line" ]; then
    echo "none"
    return 0
  fi
  sed 's/[[:space:]]*ID:.*//' <<<"$line"
}

trellis_harness_in_progress_issue_count() {
  trellis_harness_active_issue_count
}

# Sprint time-boxing uses issue labels (e.g. sprint:2026-w25, sprint:current).
# There is no trellis cycle * CLI — query with: trellis issue list --label sprint:current
# TRELLIS_SPRINT_LABEL — explicit label; TRELLIS_CYCLE_ID — deprecated alias.
trellis_harness_sprint_label() {
  if [ -n "${TRELLIS_SPRINT_LABEL:-}" ]; then
    echo "$TRELLIS_SPRINT_LABEL"
    return 0
  fi
  if [ -n "${TRELLIS_CYCLE_ID:-}" ]; then
    echo "$TRELLIS_CYCLE_ID"
    return 0
  fi
  echo "in_progress ($(trellis_harness_in_progress_issue_count) issues)"
}

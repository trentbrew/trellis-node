---
name: trellis-vcs
description: >
  TrellisVCS workflow skill for graph-native version control. Use this skill when the user mentions
  TrellisVCS, milestones, the Idea Garden, semantic diffs, or causal op streams. Teaches the correct
  workflow: milestones instead of commits, garden checks before new work, semantic diffs for code review.
  Do NOT use for standard Git operations on non-TrellisVCS repositories.
created: 2026-05-30
updated: 2026-05-30
license: Apache-2.0
allowed-tools:
  - bash
  - str_replace_editor
metadata:
  category: development
  complexity: intermediate
compatibility: Claude Code 1.0+, OpenCode 0.1+
---

# TrellisVCS Workflow Skill

TrellisVCS is a graph-native, code-first version control system. **It is not Git.**
Every file save is an immutable op. You do not stage, commit, or push.

## Core Concepts

- **Ops** — Immutable, content-addressed operations (file changes, branches, milestones)
- **Milestones** — Narrative checkpoints spanning a range of ops (replace Git commits)
- **Idea Garden** — Automatically detects abandoned work and lets you revive it
- **Semantic Diff** — AST-level diffs showing symbolAdd, symbolRename, symbolMove

## Standard Workflow

### 1. Always check status first

```bash
trellis status
```

### 2. Check the Idea Garden before new features

```bash
trellis garden list
trellis garden search -k "auth"
```

If relevant abandoned work exists, revive it instead of starting from scratch.

### 3. Work normally — ops are automatic

File changes during `trellis watch` are recorded automatically as Tier 0 ops.
You do **not** need to stage or commit.

### 4. Create milestones at meaningful points

```bash
trellis milestone create -m "Implement user authentication"
```

### 5. Use semantic diffs for code review

```bash
trellis sdiff src/old.ts src/new.ts
```

This shows AST-level changes (symbolAdd, symbolRemove, symbolRename) instead of line diffs.

## CLI Quick Reference

| Command | Purpose |
|:--------|:--------|
| `trellis status` | Current branch, op count, tracked files |
| `trellis log [--limit N]` | Op history |
| `trellis milestone create -m "msg"` | Create narrative checkpoint |
| `trellis milestone list` | List all milestones |
| `trellis branch [name]` | List or create branches |
| `trellis diff` | File-level diff |
| `trellis sdiff` | Semantic (AST-level) diff |
| `trellis garden list` | Show abandoned work clusters |
| `trellis garden revive <id>` | Revive cluster into a branch |
| `trellis watch` | Watch for file changes |

## MCP Integration

If the TrellisVCS MCP server is connected, use tool calls instead of CLI:
- `trellis_status` / `trellis_log` / `trellis_files`
- `trellis_milestone` / `trellis_branch`
- `trellis_garden` / `trellis_diff`
- `trellis_parse` / `trellis_semantic_diff`

## Guidelines

- **Never** modify `.trellis/` directly — use CLI or MCP tools
- **Milestones, not commits** — create one per coherent unit of work
- **Check the garden** — abandoned work may already solve your problem
- **Prefer semantic diffs** for TypeScript/JavaScript changes
- **Ops are immutable** — they are never rewritten, rebased, or deleted

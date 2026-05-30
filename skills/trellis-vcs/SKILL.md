---
name: trellis-vcs
description: >
  Skill for TrellisVCS — the graph-native version control and issue tracking system.
  Teaches agents how to manage branches, milestones, issues, the Idea Garden, and
  semantic AST-level diffs using the Trellis CLI. Use this skill when working
  inside a Trellis-enabled workspace or repository, context-switching between issues,
  tracking changes, or checking the state of a project.
---

# TrellisVCS Skill

TrellisVCS is a local-first version control and issue tracking engine powered by Trellis.
Instead of text-level commits, it tracks code changes as graph-native EAV operations.
It offers branches, milestones, task tracking with automated verification gates, and
the "Idea Garden" (a way to discover and revive abandoned reasoning or context-switches).

## Mental Model: VCS as Agent State

| Agentic Need | Trellis CLI Command | Purpose |
| :--- | :--- | :--- |
| **Episodic Memory** | `trellis log` | A complete, causal stream of every action taken in the repository. |
| **Reasoning Audit** | `trellis decision` | Structured traces of tool calls, inputs, outputs, and rationale. |
| **Exploration / Simulation** | `trellis branch <name>` | Creating a safe fork of the environment to test a hypothetical implementation. |
| **Task Checkpoint** | `trellis milestone` | A narrative summary of a completed objective or sub-goal. |
| **Knowledge Retrieval** | `trellis query` | Querying the EAV graph for related files, issues, or prior decisions. |
| **Conflict Resolution** | `trellis merge` | Reconciling work from multiple agents or human-in-the-loop edits. |
| **Memory Retrieval** | `trellis garden` | Discovering and reviving abandoned reasoning paths or stale context. |

### Key Differences from Git

1. **No staging area.** State changes and file mutations are recorded automatically on change (usually via `trellis watch`).
2. **Ops are immutable.** They are never rewritten, rebased, or deleted.
3. **Three-tier ops:** Tier 0 (file-level), Tier 1 (structural), Tier 2 (semantic/AST).
4. **Milestones $\neq$ commits.** A milestone spans a *range* of operations and carries a narrative message.
5. **Idea Garden.** Automatically detects abandoned work (context-switches, stale branches, reverts) and lets you revive it.

---

## Core CLI Workflows

### 1. Starting Work and Context Check

Always check status and check the Idea Garden for existing context before starting fresh:

```bash
# Check current branch, op counts, and untracked files
trellis status

# View recent causal history
trellis log --limit 20

# Search the Garden for abandoned work before starting fresh
trellis garden list
trellis garden search -k "<keyword>"
```

### 2. Issue Lifecycle (The Golden Path)

Always use `trellis issue start TRL-N` (instead of manual branching) — it creates a linked branch with full traceability and automatically sets the status to `in_progress`.

```bash
# 1. Create a task (defaults to 'backlog' status)
trellis issue create -t "Add Python parser" -P high -l parser \
  --desc "Short description of the task" \
  --ac "test:bun test test/semantic/python" \
  --ac "Handles decorators and async functions"

# 2. Triage task (move from backlog to queue/open)
trellis issue triage TRL-1

# 3. Start working (auto-creates branch, auto-assigns, and checks out)
trellis issue start TRL-1

# 4. Check status of current issue & verify criteria
trellis issue active
trellis issue check TRL-1

# 5. Pause when context-switching (safely switches back to main/default)
trellis issue pause TRL-1

# 6. Resume when context-switching back
trellis issue resume TRL-1

# 7. Close (runs all acceptance criteria, requires confirmation)
trellis issue close TRL-1 --confirm
```

### 3. Branching & Milestones

For ad-hoc exploration, use standard branches and record checkpoints via narrative milestones:

```bash
# Create/switch to a branch
trellis branch feature/new-parser

# List all branches
trellis branch

# Create a milestone checkpoint (replaces commits as the unit of narrative)
trellis milestone create -m "Implement basic parser AST nodes"
```

### 4. Semantic Code Analysis

Use semantic parsers and diffs to evaluate code changes at the AST (symbol) level:

```bash
# Parse a file into AST entities
trellis parse src/engine.ts

# Generate semantic diff (tracks symbol additions, removals, and renames)
trellis sdiff src/old.ts src/new.ts
```

### 5. Managing the Idea Garden

The Idea Garden stores abandoned reasoning clusters and dead paths. You can revive them at any point:

```bash
# List all abandoned clusters
trellis garden list

# Search for dead/stale work by keyword
trellis garden search -k "auth"

# Revive a cluster into a new, active branch
trellis garden revive <cluster-id>
```

### 6. Decision Traces

Trellis automatically tracks MCP tool calls and shell operations as `DecisionTrace` entities. Use them to trace the rationale behind changes:

```bash
# See recent agent decisions
trellis decision list

# Trace the sequence of decisions affecting a specific issue or file
trellis decision chain issue:TRL-5
```

---

## Critical Rules

- **Never** modify the `.trellis/` directory directly — let the Trellis engine handle operations.
- **Start issues, don't just branch** — `trellis issue start` provides deep integration and history tracking.
- **Pause before context-switching** — always run `trellis issue pause` to switch branches cleanly.
- **Two-phase close gate** — all issue acceptance criteria must pass, and `--confirm` is required to close an issue.
- **Add descriptions** — use `--desc` on create or `trellis issue describe` for short descriptions.

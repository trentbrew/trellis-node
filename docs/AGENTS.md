# Trellis ù The Agentic Framework Guide

> **Trellis is more than version control.** It is a structured runtime for building agents that understand code, remember everything, and explain themselves. While it uses VCS-like primitives (branches, milestones, causal logs), these are the building blocks of an **Agentic State Engine**.

---

## The Trellis Framework

Trellis provides the durable state layer that modern agentic systems require. Instead of manual state management, Trellis gives your agents:

1. **Causal Memory**: Every thought, tool call, and file change is an immutable operation.
2. **Safe Simulation**: Agents can fork the repository state to explore multiple paths without side effects.
3. **Structured Reasoning**: Decision traces link actions back to context, policy, and precedent.
4. **Semantic Accuracy**: Agents operate on AST entities (functions, classes), not just lines of text.

---

## Mental Model: VCS as Agent State

| Agentic Need | Trellis Primitive | Purpose |
| :--- | :--- | :--- |
| **Episodic Memory** | `trellis log` | A complete, causal stream of every action taken by the agent. |
| **Reasoning Audit** | `trellis decision` | Structured traces of tool calls, inputs, outputs, and rationale. |
| **Exploration / Simulation** | `trellis branch` | Creating a safe fork of the environment to test a hypothetical implementation. |
| **Task Checkpoint** | `trellis milestone` | A narrative summary of a completed objective or sub-goal. |
| **Knowledge Retrieval** | `trellis query` | Querying the EAV graph for related files, issues, or prior decisions. |
| **Conflict Resolution** | `trellis merge` | Reconciling work from multiple agents or human-in-the-loop edits. |
| **Memory Retrieval** | `trellis garden` | Discovering and reviving abandoned reasoning paths or stale context. |

---

## Core Framework Modules

Trellis is built as a set of modular subpaths that provide the end-to-end agentic stack:

- `trellis/core`: The EAV graph kernel and entity registry.
- `trellis/llm`: Unified abstraction for model providers (Anthropic, OpenAI, etc.).
- `trellis/context`: Token-aware context window and RAG management.
- `trellis/decisions`: Automatic capture and querying of decision traces.
- `trellis/semantic`: AST-level parsing and semantic diffing.
- `trellis/ai`: Semantic indexing and vector search.

---

## Workflows for Building Agents

### 1. Initializing the Agentic Environment

```typescript
import { TrellisVcsEngine } from 'trellis';

const engine = new TrellisVcsEngine({ rootPath: './my-project' });
await engine.initRepo(); // Standardizes the causal stream
```

### 2. Executing a Reasoning Loop (ReAct)

When an agent performs a task, it should operate within a specific **Branch** to ensure safety.

```bash
# Create a safe exploration fork
trellis branch feature/agent-task-01
```

### 3. Recording Decision Traces

Every tool call the agent makes should be wrapped in a decision trace.

```bash
trellis decision list                           # See recent agent thoughts
trellis decision chain issue:TRL-5              # Trace why a specific entity changed
```

### 4. Creating Narrative Milestones

When an agent completes a task, it doesn't just "finish." It creates a Milestone that summarizes its work for human review.

```bash
trellis milestone create -m "Refactored the authentication layer to use JWT"
```

---

## Guidelines for Building Trellis Agents

1. **Safety First (Fork Early)**: Always start complex agent tasks in a new branch. This allows for easy rollback and human-in-the-loop review before merging to `main`.
2. **Context is Causal**: Use `trellis log` and `trellis decision chain` to provide the agent with the "why" behind existing code. Don't just give it the current text; give it the history.
3. **Semantic over Textual**: Encourage agents to use `trellis sdiff` to understand changes at the AST level. This prevents broken syntax and logical errors caused by line-level diffing.
4. **The Garden is Memory**: Use `trellis garden` to help agents recover context from abandoned tasks or context switches.
5. **Sign Every Action**: Ensure every agent possesses an Ed25519 identity. This provides non-repudiation and auditability for every operation in the stream.
6. **Use wiki-links**: Leverage `[[TRL-5]]` or `[[src/engine.ts#run]]` in agent rationales to create a dense, navigable knowledge graph.

---

## Framework Architecture

```
src/
??? core/         # EAV store, kernel, ontology, query, agents, plugins
??? llm/          # Unified LLM provider abstraction (NEW)
??? context/      # Context window & RAG management (NEW)
??? vcs/          # Causal stream, branches, milestones, merge
??? links/        # Wiki-link parser & resolution
??? embeddings/   # Semantic indexing & vector store
??? decisions/    # Decision trace capture & hooks
??? semantic/     # AST parser & semantic diff/merge
??? sync/         # CRDT reconciler & peer sync
??? watcher/      # Ingestion pipeline
??? mcp/          # MCP server integration
??? cli/          # CLI command surface
```

### The Five Pillars of the Trellis Runtime

1. **Causal Stream** ù Immutable audit log of every state change.
2. **Semantic Patching** ù AST-level operations instead of text edits.
3. **Decision Intelligence** ù Structured rationale and precedent search.
4. **Governance Subgraph** ù Cryptographic identities and policy enforcement.
5. **Exploration Memory** ù The Idea Garden for reviving abandoned work.
ù every file change creates ops in real time               |
| `git log`          | `trellis log` ù causal op stream with content-addressed hashes       |
| Tag / release      | `trellis milestone create -m "ù"` ù narrative checkpoint             |
| Branch             | `trellis branch <name>` ù same concept, with CRDT support            |
| `git diff`         | `trellis diff` (file-level) or `trellis sdiff` (AST-level)           |
| `git merge`        | `trellis merge <branch>` ù three-way with conflict markers           |
| Stash / abandoned  | `trellis garden` ù discovers and revives abandoned work              |
| Issue / ticket     | `trellis issue` ù first-class task tracking with acceptance criteria |

### Key Differences from Git

1. **No staging area.** Ops are created automatically when files change.
2. **Ops are immutable.** They are never rewritten, rebased, or deleted.
3. **Three-tier ops:** Tier 0 (file-level), Tier 1 (structural), Tier 2 (semantic/AST).
4. **Milestones ? commits.** A milestone spans a _range_ of ops and carries a narrative message.
5. **Idea Garden.** Automatically detects abandoned work (context-switches, stale branches, reverts) and lets you revive it.

---

## Workflows

### Starting Work

```bash
# Check current state
trellis status

# See recent history
trellis log --limit 20

# Check for abandoned work before starting new features
trellis garden list
```

### Creating a Milestone

When you reach a meaningful point (feature done, bug fixed, refactor complete):

```bash
trellis milestone create -m "Implement user authentication"
```

### Branching

```bash
trellis branch feature/new-parser    # Create + switch
trellis branch                       # List branches
trellis branch -d old-experiment     # Delete
```

### Agent Lanes (multi-agent isolation)

Each agent gets an isolated op journal (`lane-{uuid}`). `issue start` creates and enters a lane by default (`--no-lane` to opt out).

```bash
trellis issue start TRL-1            # Branch + lane
trellis lane enter <lane-id>         # Route writes; materialize to worktree when bound
trellis lane promote <lane-id>       # Replay onto integration ù before issue close
export TRELLIS_LANE_ID=lane-ù        # Subprocess agents auto-enter
```

**Worktree bind (3.2.3+):** `"lanes": { "worktreeBind": true }` in `.trellis/config.json` provisions `.trellis/worktrees/<shortId>/` per lane. Edit there ù not the shared repo root. See ADR 0014.

Graph MCP `agent:<id>` lanes attribute graph writes only; desk trail markers are coordination metadata, not VCS.

### Agent handoff protocol (3.2.3+)

Record trellis-handoffs YAML envelopes as graph-backed child issues. Re-orient after context switches with `whereami`. See ADR 0015.

```bash
# Record a handoff (creates label:message or label:decision child)
trellis protocol send --parent TRL-41 \
  --from strategist --to human --re TRL-41 --status DECISION \
  --body "Path A ù ship after review PASS"

# Re-entry dump: WAITING ON YOU / ACTIVE / MOVED SINCE LAST
trellis whereami
trellis whereami checkpoint   # writes .trellis/reentry-checkpoint.json
```

Cursor pipeline hooks still handle auto-advance; protocol children are the durable audit trail.

### Exploring Abandoned Work

Before starting new work, check the Idea Garden:

```bash
trellis garden list                  # All clusters
trellis garden search -k "auth"      # Search by keyword
trellis garden revive <cluster-id>   # Revive into a new branch
```

### Issue Tracking

```bash
# Create an issue (defaults to 'backlog' status)
trellis issue create -t "Add Python parser" -P high -l parser \
  --desc "Short description of the task" \
  --ac "test:bun test test/semantic/python" \
  --ac "Handles decorators and async functions"

# Create with explicit status
trellis issue create -t "Urgent fix" -P critical -S open

# Triage: move from backlog ? open (ready for work)
trellis issue triage TRL-1

# Start working (auto-creates branch, auto-assigns)
# Works from both 'backlog' and 'open' status
trellis issue start TRL-1

# Pause to handle something else, resume later
trellis issue pause TRL-1
trellis issue resume TRL-1

# Update issue metadata
trellis issue update TRL-1 --title "New title" --desc "Updated description" \
  --status queue -P high -l label1,label2 --assignee agent:cascade

# Set or update description
trellis issue describe TRL-1 "Short description text"

# Run acceptance criteria
trellis issue check TRL-1

# Close (requires all tests pass + manual confirmation)
trellis issue close TRL-1 --confirm

# List / filter (includes backlog status)
trellis issue list --status backlog
trellis issue list --status queue
trellis issue active
```

### Semantic Analysis

```bash
trellis parse src/engine.ts          # Parse into AST entities
trellis sdiff src/old.ts src/new.ts  # Semantic diff (symbolAdd, symbolRename, etc.)
```

### Decision Traces

Decision traces are automatically captured from MCP tool invocations. They record
what tool was called, with what inputs, and what it produced ù forming an audit trail.

```bash
trellis decision list                           # Recent decisions
trellis decision list --tool trellis_issue_*    # Filter by tool pattern
trellis decision show DEC-1                     # Full decision trace
trellis decision chain issue:TRL-5              # All decisions affecting an entity
```

External agent harnesses can enrich traces with rationale, alternatives, and prompt
context via the pre/post hook API in `src/decisions/hooks.ts`.

---

## MCP Tools Reference

If connected via MCP, these tools are available:

| Tool                     | Purpose                                                                |
| :----------------------- | :--------------------------------------------------------------------- |
| `trellis_status`         | Branch, op count, tracked files, recent ops                            |
| `trellis_log`            | Op history with optional file/limit filters                            |
| `trellis_files`          | List all tracked files                                                 |
| `trellis_branch`         | List / create / switch / delete branches                               |
| `trellis_milestone`      | List or create narrative milestones                                    |
| `trellis_diff`           | File-level diff between two op hashes                                  |
| `trellis_garden`         | List / search / stats / revive idea clusters                           |
| `trellis_parse`          | Parse TS/JS content into AST entities                                  |
| `trellis_semantic_diff`  | Semantic diff between two file versions                                |
| `trellis_init`           | Initialize a new TrellisVCS repository                                 |
| `trellis_issue_create`   | Create issue with title, description, priority, labels, criteria       |
| `trellis_issue_list`     | List/filter issues by status (backlog/queue/in_progress/paused/closed) |
| `trellis_issue_start`    | Start issue from backlog or queue (auto-branch, auto-assign)           |
| `trellis_issue_pause`    | Pause issue, switch to default branch                                  |
| `trellis_issue_resume`   | Resume issue, switch to issue branch                                   |
| `trellis_issue_triage`   | Move issue from backlog ? queue                                        |
| `trellis_issue_update`   | Update issue metadata (title, description, status, priority, labels)   |
| `trellis_issue_check`    | Run acceptance criteria                                                |
| `trellis_issue_close`    | Close issue (requires tests pass + confirm)                            |
| `trellis_decision_list`  | List/filter decision traces by tool, agent, entity, time               |
| `trellis_decision_show`  | Show full decision trace details by ID                                 |
| `trellis_decision_chain` | Trace all decisions that affected a given entity                       |

---

## Guidelines for AI Agents

1. **Always check `trellis status` first** to understand the current repo state.
2. **Use milestones, not commits.** Create a milestone when you complete a coherent unit of work.
3. **Check the garden** before starting new features ù someone may have abandoned relevant work.
4. **Prefer `trellis sdiff`** over line-level diffs when reviewing TypeScript/JavaScript changes.
5. **NEVER read, write, edit, or delete files inside `.trellis/`** ù this directory contains the immutable op log and is managed exclusively by the engine. Direct edits WILL corrupt the causal chain. If `ops.json` appears corrupted, run `trellis repair` instead of editing the file. Always use the CLI or MCP tools for all VCS operations.
6. **Ops are automatic.** File changes during `trellis watch` generate ops without manual intervention.
7. **Branch names** follow the same conventions as Git: `feature/`, `fix/`, `experiment/`, etc.
8. **Use issues for task tracking.** Create issues before starting work, add acceptance criteria, and close only when criteria pass.
9. **Start issues, don't just branch.** `trellis issue start` creates a linked branch automatically. This provides better traceability.
10. **Pause before context-switching.** If you need to work on something else, `trellis issue pause` first.
11. **Issues default to backlog.** New issues start in `backlog`. Use `trellis issue triage` to move them to `queue` when ready, or `trellis issue start` to jump straight to `in_progress`.
12. **Add descriptions.** Use `--desc` on create or `trellis issue describe` to add a short description. For longer notes, use `summary.md` in the issue directory.
13. **Decision traces are automatic.** MCP tool calls emit `vcs:decisionRecord` ops. Use `trellis decision chain <entity>` to see what decisions affected an entity.
14. **Use `[[wiki-links]]`** in markdown and doc-comments to reference entities: `[[TRL-5]]`, `[[src/engine.ts]]`, `[[src/engine.ts#createIssue]]`, `[[decision:DEC-1]]`.
15. **Handoff protocol (3.2.3+).** Record envelopes with `trellis protocol send`; re-orient with `trellis whereami` after context switches (ADR 0015).

---

## Architecture (for context)

```
src/
??? protocol/   # Handoff envelope parse + whereami re-entry (ADR 0015)
??? vcs/          # Core: types, ops, decompose, branch, milestone, checkpoint, diff, merge, issue, blob-store
??? links/        # Wiki-link parser, resolver, bidirectional ref index
??? embeddings/   # Semantic embeddings + SQLite vec store
??? decisions/    # Decision trace auto-capture, hooks, queries
??? git/          # Git import/export bridge
??? identity/     # Ed25519 keys, op signing, governance policies
??? garden/       # Idea Garden: cluster detection + query/revive
??? semantic/     # AST parser + semantic diff/merge
??? sync/         # Peer sync: CRDT reconciler + sync engine
??? watcher/      # Filesystem watcher + ingestion pipeline
??? mcp/          # MCP server (this integration)
??? cli/          # CLI commands
??? engine.ts     # Composition root
??? index.ts      # Public API surface
```

### Five Pillars

1. **Causal Stream** ù Immutable, content-addressed ops with causal chaining
2. **Semantic Patching** ù AST-level diffs (symbolAdd, symbolRename, symbolMove)
3. **Narrative Milestones** ù Human-readable checkpoints spanning op ranges
4. **Governance Subgraph** ù Ed25519 identities, signed ops, policy rules
5. **Idea Garden** ù Automated detection and revival of abandoned work

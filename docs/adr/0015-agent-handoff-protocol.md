# ADR 0015: Agent handoff protocol

> **Terminology:** **Protocol message** = trellis-handoffs YAML envelope stored on a child issue (`label: message` | `label: decision`). Distinct from VCS **lane** (`lane-{uuid}`) and graph MCP **agent:** attribution.

**Status:** Accepted  
**Date:** 2026-06-29  
**Issue:** TRL-39 (proposal), TRL-40 (spec), TRL-41 (impl)  
**Depends on:** [0005](./0005-agent-lane-naming.md) (lane naming), trellis-handoffs skill (envelope IR), [0014](./0014-git-materialization-and-lane-worktrees.md) (W5 worktree bind for concurrent dogfood)  
**Supersedes:** nothing

## Context

The trellis-agent-pipeline coordinates multi-role agent loops via:

1. **Protocol IR** — `from` / `to` / `re` / `status` YAML footer + turn banner (`trellis-handoffs`)
2. **Work substrate** — Trellis-VCS issues, lanes, promote
3. **Transport** — Cursor hooks, session JSON (`pipeline_auto`, `pipeline_run_log`)

Steps 1–2 were split: envelopes lived in chat and issue descriptions without queryability. Step 3 duplicated run state outside the graph.

Phase **1a** (this ADR) promotes the envelope to **first-class issue children** and adds **`trellis whereami`** for human re-entry — without replacing Cursor transport.

## Decision

### v1: ProtocolMessage = issue child

Record handoffs via `trellis protocol send`:

- Child issue under parent wedge
- `label: message` (default) or `label: decision` when `status: DECISION`
- `description` = turn banner + YAML envelope (parseable)

**No new kernel entity types** until EQL-S filters on envelope fields creak.

### `trellis whereami`

Stdout sections:

| Section | Source |
| ------- | ------ |
| **WAITING ON YOU** | Open `label:decision` children; open `label:message` with `to: human` |
| **ACTIVE** | `in_progress` issues, active lane, `worktreePath`, suggested edit root |
| **MOVED SINCE LAST** | New protocol children since `.trellis/reentry-checkpoint.json` |

`trellis whereami checkpoint` writes the manifest (downstream cache, not authoritative).

### Workflow ontology (deferred detail)

`core:Workflow` remains a stub. The C→F?→A→B→D→C pipeline is encoded in role skills + Cursor hook routing. **Phase 1b** may specialize `core:Workflow` with stages and transition table.

### Authority model

```
Trellis graph (issues + protocol children)  ← source of truth for handoff audit
Cursor session JSON                         ← transport cache (pipeline_auto)
Cursor hooks                                ← execution runtime
```

## Consequences

**Positive**

- Graph-queryable open decisions and messages
- `whereami` replaces ad-hoc footer parsing for re-entry
- Dogfoods W5 concurrent lane isolation (shipped **3.2.3**)
- Portable IR — MCP/headless runtimes can write same envelope shape

**Negative**

- Envelope parse is best-effort on `description` text until promoted entity
- Checkpoint manifest is honor-system MOVED proxy
- Cursor agents still need hook/session injection for worktree edit root

## Implementation phases

| Phase | Scope |
| ----- | ----- |
| **1a** (TRL-41) | ✅ **3.2.3** — `src/protocol/*`, `trellis protocol send`, `trellis whereami`, tests, this ADR |
| **1b** | Pipeline stop hook writes graph + session; `core:Workflow` data instance |
| **2** | `ProtocolMessage` entity; EQL-S filters on `to`, `status`, stall thresholds |

## Non-goals (1a)

- Engine `enterLane` / `leaveLane` changes
- ADR 0014 Phase 1 git materialize on promote
- Human envelope enforcement in Studio

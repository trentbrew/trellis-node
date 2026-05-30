# ADR 0001: Per-workspace journal files

> **Terminology ([ADR 0005](./0005-agent-lane-naming.md)):** Historical title. Canonical: **Agent Lane**, `.trellis/lanes/`, `LaneOpLog`, `activeLaneId`, `trellis lane`.

**Status:** Accepted  
**Date:** 2026-05-29  
**Issue:** TRL-35  
**Context:** [Agent Lanes plan](../../../tooling/planning/agent-lanes.md)

## Context

TrellisVCS today uses a single `.trellis/ops.json` with:

- Global `previousHash` chaining via `getLastOp()`
- One file lock (`ops.json.lock`, 5s timeout) on every append
- Full replay of all ops on `open()`

Eight concurrent agents cause lock contention and causal interleaving. Git worktrees do not help because `.trellis` is gitignored.

## Decision

Use **per-workspace journal files** under `.trellis/workspaces/{id}/ops.json`, plus one **integration journal** at `.trellis/ops.json` for the integration branch (default `main`).

### Layout

```text
.trellis/
  ops.json                      # integration branch only
  state.json                    # { currentBranch, activeWorkspaceId? }
  workspaces/
    ws-{uuid}/
      meta.json                 # fork metadata, lease, status
      ops.json                  # workspace-scoped journal
      ops.json.lock             # independent lock domain
```

### Write routing

| Mode | Journal | `previousHash` source |
| ---- | ------- | --------------------- |
| No active workspace | `.trellis/ops.json` | Integration log tail |
| `activeWorkspaceId` set | `workspaces/{id}/ops.json` | Workspace log tail |

Integration writes are **forbidden** while `activeWorkspaceId` is set (except promote transaction).

### Alternatives considered

| Option | Rejected because |
| ------ | ---------------- |
| **Tagged single log** (`workspaceId` on each op in one file) | Still one lock; replay scans entire log; promotion requires compaction |
| **Copy whole `.trellis` per agent** | Disk heavy; blob dedup breaks; no single promote point |
| **Git worktree only** | Does not isolate semantic state; gitignored `.trellis` |

## Consequences

**Positive**

- Parallel agents append to different locks
- Promotion boundary is explicit (replay workspace journal → integration)
- Workspace drop/archive is a directory operation
- Aligns with DESIGN.md `Workspace` entity as “checked-out view”

**Negative**

- More files to manage; need GC for dropped workspaces
- `open()` must not replay all workspace journals eagerly (lazy replay per active workspace)
- Cross-workspace queries need federation or promote-first workflow

## Implementation notes (W1)

- Extract `JsonOpLog` → reusable `OpLog` with configurable path
- `WorkspaceOpLog` = `OpLog` with path `workspaces/{id}/ops.json`
- Store fork point in `meta.json`: `baseBranch`, `baseOpHash`

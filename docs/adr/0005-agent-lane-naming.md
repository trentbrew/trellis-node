# ADR 0005: Agent Lane naming

**Status:** Accepted  
**Date:** 2026-05-29  
**Issue:** TRL-35 (W0 addendum)  
**Supersedes terminology in:** [0001](./0001-workspace-journal-model.md)–[0004](./0004-branch-advance-policy.md)  
**Plan:** [Agent Lanes](../../../tooling/planning/agent-lanes.md)

## Context

ADR 0001–0004 used **Agent Workspace** / `workspace` for the isolated op-journal fork used by concurrent agents. **Workspace** is overloaded across the Trellis ecosystem:

| Existing term | Meaning |
| ------------- | ------- |
| TRELLIS workspace | Desk folder (clones + orchestration) |
| Trellis Studio | "Creative workspace" (product) |
| `WorkspaceConfig` | Kernel declarative `.trellis` config |
| TurtleDB tenant workspace | Hosted draft/publish boundary |
| `trellis init` | Initialize a Trellis-enabled **repo** |
| Remote workspace (CLI) | Federation subscription |
| Idea Garden **Cluster** | Abandoned reasoning sequence |

The prior CLI abbrev **`trellis ws`** reduced CLI collision but not conceptual ambiguity ("create a workspace" is unclear in Studio sessions).

## Decision

Rename the VCS isolation primitive to **Agent Lane** (noun: **lane**).

| Before (0001–0004) | After (canonical) |
| ------------------ | ----------------- |
| Agent Workspace | **Agent Lane** |
| `trellis ws` | **`trellis lane`** |
| `.trellis/workspaces/` | **`.trellis/lanes/`** |
| `ws-{uuid}` | **`lane-{uuid}`** |
| `workspace:{id}` entity | **`lane:{id}`** |
| `AgentWorkspace` type | **`AgentLane`** |
| `activeWorkspaceId` in `state.json` | **`activeLaneId`** |
| `workspaceId` on ops | **`laneId`** |
| `vcs:workspaceCreate` | **`vcs:laneCreate`** |
| `vcs:workspaceDrop` | **`vcs:laneDrop`** |
| `vcs:workspacePromoteStart` | **`vcs:lanePromoteStart`** |
| `vcs:workspacePromoteComplete` | **`vcs:lanePromoteComplete`** |
| `vcs:workspacePromoteAbort` | **`vcs:lanePromoteAbort`** |
| `WorkspaceOpLog` | **`LaneOpLog`** |
| `kernel/src/vcs/workspace.ts` | **`kernel/src/vcs/lane.ts`** |
| `TRELLIS_WORKSPACE_ID` env | **`TRELLIS_LANE_ID`** |

**Workspace** remains reserved for repo-level / tenant-level / desk-level scope — not per-agent op isolation.

### Rationale for "Lane"

- Parallel agents = parallel **lanes** (matches multi-agent desk playbook).
- No collision with Idea Garden Cluster, kernel WorkspaceConfig, or TurtleDB tenant workspace.
- Enter/leave/promote verbs read naturally: `trellis lane enter`, `trellis lane promote`.

Alternatives considered: **Room** (CLI `rm` collision), **Island** (weaker parallelism metaphor), **Cluster** (Idea Garden), **Station** (workstation ambiguity).

## Consequences

**Positive**

- Unambiguous docs, issues, and agent instructions.
- W1 implementation uses final names — no rename pass after engine wiring.

**Negative**

- ADR 0001–0004 retain historical "workspace" prose; each links here for canonical terms.
- Desk trail marker migrates `entity:trail-agent-workspaces` → `entity:trail-agent-lanes` (update graph entity when convenient).
- Issue labels `agent-workspaces` may coexist until issues are re-labeled (epic TRL-34 unchanged).

## Migration (pre-W1)

1. Rename kernel module `workspace.ts` → `lane.ts`; `WorkspaceOpLog` → `LaneOpLog`.
2. Plan doc: `agent-workspaces.md` → `agent-lanes.md` (stub redirect at old path).
3. Trail marker + ecosystem graph work id updated.
4. No on-disk `.trellis/lanes/` exists in production yet — no data migration.

## References

- Program plan: `tooling/planning/agent-lanes.md`
- W1 scope: plan § "W1 implementation scope"

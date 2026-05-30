# ADR 0003: Workspace conflict taxonomy

> **Terminology ([ADR 0005](./0005-agent-lane-naming.md)):** Conflicts during **`trellis lane promote`**; `laneOpHash` replaces `workspaceOpHash`.

**Status:** Accepted  
**Date:** 2026-05-29  
**Issue:** TRL-35  
**Depends on:** [ADR 0002](./0002-workspace-promote-algorithm.md)

## Context

Promotion replays workspace ops onto integration state. Conflicts must be classified so agents can self-resolve (safe) or escalate (hard).

Extends DESIGN.md §4.4 (patch commutativity) to **VCS + EAV ops**, not only semantic patches.

## Decision

Four conflict classes during `ws promote`:

| Class | Detection | Auto-merge? | Example |
| ----- | --------- | ----------- | ------- |
| **safe** | Disjoint entity IDs (and file paths for Tier-0) | Yes | Agent A edits `issue:TRL-10`, Agent B edits `issue:TRL-11` |
| **soft** | Same entity, different attributes | No — pick ours/theirs/combine | Both update `issue:TRL-10` `description` |
| **hard** | Same entity + same attribute, different values | No — block promote | Both set `issue:TRL-10` `status` to different values |
| **file** | Tier-0 modify-modify same path | Use `threeWayMerge` | Both edit `src/engine.ts` |

### Detection order (per replayed op)

1. Collect **touched entities** from decompose(op) (`addFacts`, `deleteFacts`, link endpoints)
2. Collect **touched files** from `vcs.filePath` / `oldFilePath`
3. Compare against integration materialized state at promote snapshot head
4. Classify per table above

### Structured conflict record

```typescript
interface WorkspaceConflict {
  class: 'safe' | 'soft' | 'hard' | 'file';
  workspaceOpHash: string;
  entityId?: string;
  attribute?: string;
  filePath?: string;
  integrationValue?: unknown;
  workspaceValue?: unknown;
  suggestion?: 'accept-ours' | 'accept-theirs' | 'manual';
}
```

### Resolution policy (v1)

- **safe:** continue replay
- **soft / hard / file (unmerged):** abort promote; emit report via `--explain`
- **file (clean three-way):** apply merged content as new `vcs:fileModify` on integration

### v2 (out of scope)

- Interactive `trellis ws promote --resolve` picker
- Semantic (Tier-2) commutativity from DESIGN §4.4

## Consequences

**Positive**

- Agents get actionable `--explain` output
- File conflicts reuse existing `merge.ts`
- Graph/issue tracking gets first-class promotion story

**Negative**

- Entity-level detection requires stable entity IDs in decompose output
- Soft conflicts block v1 promote (strict) — may require manual rebase of workspace

## Test matrix (W3)

- [x] Two lanes, disjoint issues → both promote
- [x] Same issue field → hard conflict
- [x] Same entity, different attributes → soft conflict
- [x] Same file, non-overlapping regions → file merge
- [x] Same file, modify-modify → file conflict blocks promote

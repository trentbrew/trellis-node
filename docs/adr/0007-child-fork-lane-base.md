# ADR 0007: Child fork lane base

> **Terminology ([ADR 0005](./0005-agent-lane-naming.md)):** **lane**, `forkKind`, `parentLaneId`, `virtualBaseOpHash`.  
> **Sibling fork (v1):** [ADR 0006](./0006-session-fork-lane-mapping.md).

**Status:** Accepted  
**Date:** 2026-05-29  
**Issue:** TRL-40 (W5 follow-up)  
**Depends on:** [0006](./0006-session-fork-lane-mapping.md), [0002](./0002-workspace-promote-algorithm.md)  
**Plan:** [Agent Lanes](../../../tooling/planning/agent-lanes.md)

## Context

[ADR 0006](./0006-session-fork-lane-mapping.md) maps session fork to a **sibling lane**: same integration `baseOpHash` as the parent, isolated journal for the new session. Product UX also needs **child fork** — continue from the parent lane’s **current head** (integration replay + parent journal applied), not from the original integration snapshot alone.

A child lane with only `baseOpHash = parent.baseOpHash` omits parent journal ops from its materialized base → promote could overwrite parent work silently.

## Decision

**Option A — virtual integration base** with `virtualBaseOpHash` on `LaneMeta` and materialization / promote updates in `lane-materialize.ts` and `lane-promote.ts`.

### Child fork semantics

```text
forkLane(parent, { forkKind: 'child' }):
  parentHead ← parent lane journal tail (or baseOpHash)
  child.baseOpHash ← parent.baseOpHash          # integration snapshot (unchanged)
  child.virtualBaseOpHash ← parentHead        # materialization anchor
  child.forkKind ← 'child'

enter child lane:
  store ← integration replay through baseOpHash
  store ← overlay(parent lane ops)
  store ← overlay(child lane ops)

promote child lane:
  replay child lane ops only onto integration head
  conflict detection uses ADR 0003 against integration head
  file conflicts use parent+child lane ops as "theirs" state
```

Parent lane may remain unpromoted. Child promote does **not** auto-promote the parent.

### LaneMeta extensions

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `virtualBaseOpHash?` | string | Parent lane head used as materialization fork |
| `forkKind` | `'child'` | Set when `virtualBaseOpHash` is populated |

### API

```typescript
engine.forkLane(parentId, { forkKind: 'child', sessionId })
```

CLI: `trellis lane fork <parent> --child [--session <id>]`

## Open questions (deferred)

1. Can child fork from a parent that already has a sibling-fork child? **Yes** — no kernel restriction in v1.
2. Should parent lane status change on child fork? **No** — remains `active`; Studio leaves parent session before child enter.
3. TurtleDB draft session: hosted-only first? **TBD** — kernel support is repo-local.

## Consequences

**Positive**

- Child sessions inherit parent lane edits in materialized state.
- Promote replays only child delta; explicit promote invariant preserved.
- Sibling fork unchanged.

**Negative**

- Child promote without parent promote may leave parent journal unpromoted on integration.
- Child enter replays integration through `baseOpHash` (not full integration cache) — acceptable W5 cost.

## References

- Sibling fork: [ADR 0006](./0006-session-fork-lane-mapping.md)
- Materialization: `kernel/src/vcs/lane-materialize.ts`
- Promote: `kernel/src/vcs/lane-promote.ts`

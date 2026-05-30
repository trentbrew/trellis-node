# ADR 0004: Branch advance on integration writes

> **Terminology ([ADR 0005](./0005-agent-lane-naming.md)):** **Agent Lanes** fork from `headOpHash`; lane head in `meta.json` + `AgentLane` entity.

**Status:** Accepted  
**Date:** 2026-05-29  
**Issue:** TRL-35  

## Context

`vcs:branchAdvance` exists in types and decompose but is **never emitted** from `engine.applyOp`. Branch `headOpHash` facts go stale; branch-scoped reads (DESIGN §3.5) cannot work.

Agent Workspaces fork from `headOpHash` — fixing branch advance is a prerequisite for correct workspace creation.

## Decision

After every op appended to the **integration journal** (no active workspace), emit a `vcs:branchAdvance` op for `currentBranch` pointing at the appended op hash.

### Skip advance for

- `vcs:branchAdvance` (avoid recursion)
- `vcs:branchCreate`, `vcs:branchDelete`
- `vcs:checkpointCreate` (optional — checkpoint already references op hash)
- Ops appended during **replay** or **promote transaction** (use `skipBranchAdvance` flag)

### Workspace journal writes

Do **not** advance integration branch head. Advance **workspace head** in `meta.json` + `AgentWorkspace` entity instead (W1).

### Implementation sketch

```typescript
private applyOp(op: VcsOp, opts?: { skipBranchAdvance?: boolean; journal?: 'integration' | WorkspaceId }): void {
  // ... decompose, append ...
  if (!opts?.skipBranchAdvance && journal === 'integration' && shouldAdvance(op.kind)) {
    await appendBranchAdvance(this.currentBranch, op.hash);
  }
}
```

Use async `appendBranchAdvance` from public async callers; ingestion pipeline batches or queues advance (W1 detail).

## Consequences

**Positive**

- `branch:main` `headOpHash` matches integration tail
- Workspace fork base is well-defined
- Enables `readUntil(branchHead)` scoping

**Negative**

- ~2× ops for integration writes (content + advance) until batching optimization
- Must guard replay/promote paths against double-advance

## Quick win (W0/W1 boundary)

Land branch advance for integration path in W1 alongside `WorkspaceOpLog`; add test in `kernel/test/p2/branches.test.ts`.

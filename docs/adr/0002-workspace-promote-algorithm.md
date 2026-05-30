# ADR 0002: Promote via op replay (v1)

> **Terminology ([ADR 0005](./0005-agent-lane-naming.md)):** **lane** journal, `trellis lane promote`, `vcs:lanePromote*`.

**Status:** Accepted  
**Date:** 2026-05-29  
**Issue:** TRL-35  
**Depends on:** [ADR 0001](./0001-workspace-journal-model.md)

## Context

When an agent finishes work in a workspace, changes must land on the integration branch (`main`) without corrupting the causal stream or losing attribution.

## Decision

**Promote v1 = ordered replay** of workspace journal ops onto the current integration branch head.

### Algorithm

```text
1. BEGIN promote (workspace status → promoting)
2. base ← workspace.meta.baseOpHash
3. head ← integration branch headOpHash
4. FOR op IN workspace.ops WHERE op after base (in workspace order):
     a. IF conflicts(integration_state, op) → ABORT, status → active
     b. Append op to integration journal (new previousHash = integration tail)
     c. Apply op to materialized store
5. Emit vcs:workspacePromoteComplete
6. integration branchAdvance to new tail
7. workspace status → promoted (or dropped after archive)
```

### CLI

```bash
trellis ws promote <id> [--to main] [--dry-run] [--explain]
```

- **`--dry-run`:** run conflict detection only; no writes
- **`--explain`:** human-readable conflict report (see ADR 0003)

### Idempotency

- Promote is **not** idempotent — caller must not retry after partial failure without `promote abort` recovery
- W3 adds `vcs:workspacePromoteStart` / `Abort` ops for audit trail

### Alternatives considered

| Option | Verdict |
| ------ | ------- |
| **Squash to single batch op** | Deferred to v2 — loses per-op attribution; harder to debug |
| **Merge workspace branch entity** | Reuse `vcs:merge` file three-way only — insufficient for graph/issue ops |
| **Auto-promote on agent stop** | Rejected — too risky with 8 agents; explicit promote only |

## Consequences

**Positive**

- Preserves op granularity and agent attribution
- Reuses existing decompose/replay path
- `--dry-run` gives safe preview

**Negative**

- Long workspaces → many integration ops (squash v2 mitigates)
- Integration head may move during promote — must snapshot target head at step 2 and re-validate before commit

## TurtleDB mapping (W6)

Hosted **draft session** = workspace journal; **publish** = promote replay to tenant integration stream.

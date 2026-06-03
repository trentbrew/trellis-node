# Architecture Decision Records — Agent Lanes

Decisions for the **Agent Lane** program (`trellis lane`). Status: **accepted** (W0, 2026-05-29).

| ADR | Title | Decision |
| --- | ----- | -------- |
| [0001](./0001-workspace-journal-model.md) | Lane journal model | Per-lane `ops.json` files |
| [0002](./0002-workspace-promote-algorithm.md) | Promote algorithm | Replay v1; squash deferred |
| [0003](./0003-workspace-conflict-taxonomy.md) | Conflict taxonomy | Safe / soft / hard / file |
| [0004](./0004-branch-advance-policy.md) | Branch advance policy | Emit `vcs:branchAdvance` on integration writes |
| [0005](./0005-agent-lane-naming.md) | Agent Lane naming | **Lane** replaces workspace for this feature |
| [0006](./0006-session-fork-lane-mapping.md) | Session fork → lane | Sibling lane fork; child fork deferred |
| [0007](./0007-child-fork-lane-base.md) | Child fork lane base | Virtual base at parent head |

Desk issue: **TRL-35** (W0), **TRL-36** (W1). Plan: `TRELLIS/tooling/planning/agent-lanes.md`.

### Core VCS / EAV

| ADR | Title | Decision |
| --- | ----- | -------- |
| [0008](./0008-store-op-decomposition.md) | Store op decomposition | CMS facts materialize via `decompose()` for `vcs:storeAssert` / Retract / Link / Unlink |
| [0009](./0009-kernel-formula-syntax.md) | Kernel vs CMS formula syntax | Kernel `$fn` via `ExprEvaluator`; CMS `{field}` stays client-side (TRL-20) |

## Terminology

ADR 0001–0004 use historical **workspace** prose. Canonical terms are in [0005](./0005-agent-lane-naming.md): **lane**, `.trellis/lanes/`, `trellis lane`, `LaneOpLog`, `activeLaneId`.

## Supersedes

Nothing structurally. ADR 0005 supersedes **naming only** in 0001–0004.

## Next implementation phase

**W2–W4** (TRL-37–39): ✅ CLI, promote, lazy replay. **Next: W5** worktree bind + session fork wiring (TRL-40, [ADR 0006](./0006-session-fork-lane-mapping.md)).

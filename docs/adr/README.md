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
| [0014](./0014-git-materialization-and-lane-worktrees.md) | Git materialization + lane worktrees | Blob-store commit on promote; per-lane worktree bind (W5) |

Desk issue: **TRL-35** (W0), **TRL-36** (W1). Plan: `TRELLIS/tooling/planning/agent-lanes.md`.

### Core VCS / EAV

| ADR | Title | Decision |
| --- | ----- | -------- |
| [0008](./0008-store-op-decomposition.md) | Store op decomposition | CMS facts materialize via `decompose()` for `vcs:storeAssert` / Retract / Link / Unlink |
| [0009](./0009-kernel-formula-syntax.md) | Kernel vs CMS formula syntax | Kernel `$fn` via `ExprEvaluator`; CMS `{field}` stays client-side (TRL-20) |
| [0010](./0010-kernel-rollups-and-relations.md) | Kernel rollups and relations | `evaluateRollup` + relation projection in logic middleware |

### Product / explorer shell

| ADR | Title | Decision |
| --- | ----- | -------- |
| [0011](./0011-app-shell-three-bands.md) | App shell three bands | L1 published / L2 editor / L3 operator inset — one graph, one shell (**accepted**, TRL-33) |
| [0012](./0012-graph-overlay-config-surface.md) | Graph overlay config surface | One projection canvas; anchored/ambient L3 inset; vantage detents; homo/hetero binding (**accepted**, TRL-25/38) |
| [0013](./0013-rich-text-document-model.md) | Rich text document model | Graph-native documents; `trellis/document` semantic layer; editor substrate via Tiptap/Plate; collab tiers; `presenceRelay` dev parity (**accepted**, TRL-10) |

## Terminology

ADR 0001–0004 use historical **workspace** prose. Canonical terms are in [0005](./0005-agent-lane-naming.md): **lane**, `.trellis/lanes/`, `trellis lane`, `LaneOpLog`, `activeLaneId`.

## Supersedes

Nothing structurally. ADR 0005 supersedes **naming only** in 0001–0004.

## Next implementation phase

**W2–W4** (TRL-37–39): ✅ CLI, promote, lazy replay. **Next: [ADR 0014](./0014-git-materialization-and-lane-worktrees.md) Phase 1** (git materialize on promote) → **Phase 2** (W5 worktree bind, TRL-40).

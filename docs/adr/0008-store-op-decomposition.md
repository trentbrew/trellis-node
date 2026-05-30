# ADR 0008: Decompose EAV store ops on materialization

**Status:** Accepted  
**Date:** 2026-05-30  
**Context:** turtlecode/ide Database panel, Trellis CMS / knowledge graph  
**Fix:** `kernel/src/vcs/decompose.ts` — `vcs:storeAssert`, `vcs:storeRetract`, `vcs:storeLink`, `vcs:storeUnlink`

## Context

Trellis persists CMS and knowledge-graph entities (types like `person`, `organization`, `bookmark`, `asset`, …) as **EAV facts** in the integration op log via four dedicated op kinds:

| Op kind | Payload | Effect |
| ------- | ------- | ------ |
| `vcs:storeAssert` | `vcs.facts[]` | Add facts |
| `vcs:storeRetract` | `vcs.facts[]` | Remove facts |
| `vcs:storeLink` | `vcs.links[]` | Add links |
| `vcs:storeUnlink` | `vcs.links[]` | Remove links |

Entity ids use typed prefixes (`person:sam-altman`, `organization:openai`, …), not the `entity:` prefix used by some graph APIs.

On workspace open, `TrellisVcsEngine.open()` rebuilds the in-memory EAV store through **`materializeIntegrationOps`** (`src/vcs/lane-materialize.ts`), which replays every integration op via **`decompose()`** (`src/vcs/decompose.ts`).

Until this ADR, `decompose()` handled file, issue, branch, lane, and decision ops — but **not** the four store op kinds. Replay therefore produced a store containing only **VCS-derived** entities (`Decision`, `FileNode`, `DirectoryNode`, `Issue`, …) while all CMS facts remained only on disk in `.trellis/ops.json`.

### Symptoms (looked like data loss)

- turtlecode/ide **Database** panel shows few entity types (mostly `Decision`, `FileNode`, …) or appears empty for custom types.
- `/trellis/store/entities?type=person` returns `[]` even though `ops.json` contains `vcs:storeAssert` ops for `person:*`.
- Agents querying `get_graph_summary` and filtering `entity:` ids report “missing” org/person counts — a **different** prefix filter, same underlying gap.
- **Data is not deleted.** Ops are append-only; manual replay of `ops.json` still materializes the full graph.

### Secondary replay in opencode

`packages/opencode/src/trellis/index.ts` runs an extra `replay()` after `eng.open()` that applies store ops via `mutate()`. That masked the bug in some sessions but **did not survive** `refreshMaterializedStore()` cache rebuilds (lane enter/leave, promote, full rematerialize), which only use `decompose()`.

## Decision

**Extend `decompose()`** to pass through store op payloads using the same validation as runtime `mutate()`:

```typescript
case 'vcs:storeAssert':
  result.addFacts.push(...pickFacts(vcs.facts));
  break;
case 'vcs:storeRetract':
  result.deleteFacts.push(...pickFacts(vcs.facts));
  break;
case 'vcs:storeLink':
  result.addLinks.push(...pickLinks(vcs.links));
  break;
case 'vcs:storeUnlink':
  result.deleteLinks.push(...pickLinks(vcs.links));
  break;
```

`pickFacts` / `pickLinks` accept only well-formed `{ e, a, v }` / `{ e1, a, e2 }` entries (string/number/boolean values for facts).

Tests: `kernel/test/vcs/decompose.test.ts` (store assert/retract/link cases).

## Consequences

- **Materialization = source of truth.** Store entities visible in the IDE match replay of `ops.json` without relying on opencode’s secondary `replay()`.
- **Package sync:** The `trellis` npm package consumed by turtlecode/ide (`Packages/trellis-package`) must include the same `decompose` cases; a stale bundled copy reintroduces the bug.
- **Restart after fix:** Backend must restart (`just run` / `jr`) so the engine rematerializes from disk; `--hot` reloads opencode `src/` but not necessarily patched `node_modules/trellis`.

## Diagnosis checklist

When the Database panel looks empty but agents recently created CMS entities:

1. **Confirm ops on disk** — search `.trellis/ops.json` for `vcs:storeAssert` and entity ids (e.g. `person:sam-altman`).
2. **Confirm materialized store** — `GET /trellis/store/stats?directory=<home>` then paginate `/store/entities`; expect `person`, `organization`, etc. if decompose is correct.
3. **Do not treat VCS-only counts as deletion** — high `Decision` count + zero `person` with store ops present ⇒ materialization bug, not op loss.
4. **Restart backend** after updating `decompose.ts` in the bundled `trellis` package.

## Related

- [ADR 0001](./0001-workspace-journal-model.md) — integration journal at `.trellis/ops.json`
- [ADR 0007](./0007-child-fork-lane-base.md) — `materializeIntegrationOps` / lane overlay
- turtlecode/ide `packages/app/AGENTS.md` — Database panel troubleshooting
- turtlecode/ide `justfile` `run` / `backend` — `bun run --hot --conditions=browser … serve --port 4096`

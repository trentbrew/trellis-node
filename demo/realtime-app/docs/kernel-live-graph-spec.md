# Kernel spec: version-controlled live graph

**Status:** Pre-implementation. Field prototype validated UX and seams; this document is the NLnet milestone breakdown and API contract review artifact. **Building is grant-gated; speccing is deadline-relevant.**

**Companion essay:** [Version-Controlled Live Graphs](https://brew.build/posts/version-controlled-live-graph/) (public lede + evidence; not a substitute for this spec).

---

## Reframe

| Old frame | New frame |
| --------- | --------- |
| Realtime database | **Version-controlled live graph** |
| Client SDK + sockets | Server transport semantics; thin framework adapters |
| Agent integration = new product | **Agent lanes** + `TRELLIS_LANE_ID`: multi-agent editing falls out of existing primitives |

---

## Design wins (say these loud in NLnet scope)

### 1. Kernel owns transport; adapters own `await`

- **Kernel:** diff subscription contract, patch helpers, lane overlay reads, promote semantics, single write path that emits.
- **Adapters:** Svelte `query.live` / `runLiveQueryStream()` is a thin wrapper over that contract. Same surface for React, CLI, Studio, MCP.

**Achievement:** not building a SvelteKit-specific database. Any framework consumes the same HTTP + env-var lane routing.

### 2. `TRELLIS_LANE_ID` is the whole agent story

Anything that can `POST /entities` or run `trellis db create` with `TRELLIS_LANE_ID=agent:<id>` is a **first-class writer**. No separate agent SDK, no agent-specific mutation queue, no parallel auth plane.

Multi-agent editing is **the absence of new infrastructure**: lanes, journals, and promote already exist for files; graph promote extends the same commands.

**NLnet demo that lands without prose:** pane A `trellis db watch '<eql>'`; pane B agent subprocess with `TRELLIS_LANE_ID` writing via CLI or MCP; pane C human app on `/?lane=agent:demo`; promote in either B or C.

---

## Namespace (no new product name)

```
trellis / trellis-node / @trellis/svelte / trellis/live
  trellis db …     live data
  trellis lane …   who is writing
  trellis lane promote …   land drafts on integration / main
```

No TurtleDB. No fourth noun.

---

## Kernel invariants

### Every write emits

§4.4 prototype lesson: in-process kernel writes did not reach the sidecar subscriber → live UI stale.

**Invariant:** there is **no write that does not emit** on the subscription bus. If `trellis db` exposes in-process SDK and HTTP, both must funnel through one emission path. Otherwise the invisible-write bug returns at kernel level.

### Fork base is recorded for merge

Real conflict detection is **three-way**: `lane_ops` vs `main_now` vs **`main_at_fork`**. Two-way draft-vs-main is change-detection wearing merge's clothing.

- **Journal lanes:** fork from integration head (`baseOpHash` in lane meta), **already recorded**.
- **Graph-backed lanes (`laneId` on entities):** must not merge without the same recorded ancestor. Op-log is source of truth for "main as of fork."

### Stable cross-lane identity (decide before merge code)

Prototype `promoteLane` matches **by slug**. That is a **known bug elevated into policy** if copied to kernel:

- Slug is **content-derived**, not content-addressed (rename recomputes or collides).
- Entity id is **lane-bound** `(identity, lane)` fused.
- Rename in draft → slug changes → merge-by-slug **loses anchor** → duplicate or silent mis-merge.

**Kernel decision (blocking):** cross-lane identity = **lane-independent, rename-stable id**, created once, never recomputed. Slug demoted to human alias.

Same primitive required for **Iroh peer identity** (north star). Resolving now in merge policy is pulling peer requirement forward, not scope creep.

**Do not ship** `--merge slug` as default graph promote until `stableId` (name TBD) exists in ontology + promote indexer.

---

## Realtime layers (honest)

| Layer | Payload |
| ----- | ------- |
| Sidecar → SDK subscriber | Triple **diffs** (`added` / `updated` / `removed`) |
| SDK server cache | Patches binding set; avoids re-query |
| SDK → browser (`query.live` today) | Full binding **snapshots** per yield |

**True:** diff-based data plane + SDK patch semantics.  
**False (today):** diff on the wire to the browser.

**Future boundary:** wire diffs + client reassembly (worth naming; not pretending shipped).

Blog/HN line: *"Diff subscriptions from the data plane; the SDK maintains the result set by patching rather than re-fetching; the adapter streams snapshots to the client."*

---

## Primitives

### 1. Live graph (`trellis db`)

- `serve`, `query`, `create`, … (exists)
- **Add:** documented diff subscribe API + `applyBindingDiff` in client SDK
- **Add:** `trellis db watch <eql>` (terminal tail of binding diffs)

### 2. Lane overlay (`trellis lane`)

- Same ids: `main`, `agent:<id>`, `TRELLIS_LANE_ID`
- Journal writes for agent lanes; materialized EQL reads
- **Add:** `trellis lane materialize <id> [--check]`

### 3. Graph promote (`trellis lane promote --graph`)

- Merge policy keyed on **`stableId`**, not slug
- Three-way conflict via recorded `main_at_fork`
- Reuse `--dry-run --explain` from file promote

### 4. Adapters (`@trellis/svelte` or recipe)

- `runLiveQueryStream({ load, subscribe })` only

---

## CLI target

```bash
trellis init && trellis db init --port 3920 && trellis db serve

trellis lane create --agent demo
export TRELLIS_LANE_ID=agent:demo
trellis db create framework '{"title":"Astro","stableId":"…","slug":"astro"}'

trellis db watch '…eql…'              # human / demo pane
trellis lane promote agent:demo --graph --dry-run --explain
trellis lane promote agent:demo --graph
trellis lane drop agent:demo
```

---

## NLnet milestone map (€22k framing)

Substantially this spec. **Implementation is what the grant pays for.**

| Milestone | Deliverable | Depends on |
| --------- | ----------- | ---------- |
| M1 | `stableId` ontology + create path; promote indexer uses it | Identity decision frozen |
| M2 | Single write path + emit invariant; `db` subscribe + patch helper | M1 optional for read path |
| M3 | `db watch`; graph lane materialize; fork base on graph lanes | M2 |
| M4 | `lane promote --graph` three-way + `--explain` | M1, M3 |
| M5 | Iroh transport hook + offline mutation queue (peer sync) | M1 (same id primitive) |
| M6 | `@trellis/svelte` adapter; Studio lane UI → same CLI | M2–M4 |
| M7 | Open-core packaging + docs + demo GIF (watch + lane env) | M3–M4 |

**Out of grant "tonight" scope:** landing `--graph` merge code because the sketch is clear. **In scope for application:** this document + prototype REPORT + reproducible demo script.

---

## Prototype mapping (sandbox, pre-distribution)

| Prototype | Kernel target |
| --------- | ------------- |
| `pnpm dev:trellis` / sidecar :3920 | `trellis db serve` |
| `pnpm agent:add --lane demo` | `TRELLIS_LANE_ID=agent:demo trellis db create …` |
| `promoteLane` by slug | **Replace** with `stableId` promote (M1/M4) |
| `runLiveQueryStream` | `@trellis/svelte` |
| `frameworkTag` entities | Observability rule → ontology guide |
| `tagRevision` bump | Cross-entity sub deps (follow-on) |

Technical benchmarks: [REPORT.md](./REPORT.md). Fractal / identity analysis: [fractal-responsiveness-v3.md](./fractal-responsiveness-v3.md) §3.

---

## Open decisions

| # | Question | Blocker for |
| --- | -------- | ----------- |
| 1 | `stableId` format (UUID v7 vs content hash vs signed key) | M1, M4, M5 |
| 2 | Graph lane fork base storage when not journal-only | M3, M4 |
| 3 | `--graph` flag vs subcommand naming | Docs only |
| 4 | Wire diffs to browser | Post-M4 optimization |

---

## Scope discipline

- **Spec / NLnet application:** this file + essay + demo GIF plan. **Days.**
- **Kernel build:** M1–M7. **Weeks. Grant-gated.**
- **Blog post:** reframe + evidence; must not be mistaken for shipped kernel API.

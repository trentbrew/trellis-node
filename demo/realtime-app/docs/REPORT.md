# Trellis × SvelteKit Remote Functions — Technical Report

> A graph-backed, realtime, version-controlled application built on SvelteKit
> remote functions (`query.live` / `form` / `command`) over a **Trellis** triple-store
> sidecar — with agent-isolated draft lanes, semantic merge-on-promote, and a
> WebContainer-deployable runtime.

**Status:** functionally complete reference implementation (Phases 7–15). Static checks,
lint, build, and the serial E2E profile pass. Date: 2026-06-02.

> **Kernel / NLnet:** API contract and milestones in [kernel-live-graph-spec.md](./kernel-live-graph-spec.md). Promote-by-slug in this report is prototype-only; kernel merge requires rename-stable cross-lane identity (see spec).

---

## 1. Executive summary

We built a realtime CRUD application whose entire data layer is a **knowledge graph**
(entity–attribute–value triples) rather than a relational table or document store. The
twist is the combination of three things that don't normally appear together:

1. **Server-driven realtime via SvelteKit remote functions.** No client-side database
   SDK, no manual WebSocket wiring in components — the UI consumes an `await`-ed async
   resource and the server streams diffs to it.
2. **Diff-based live queries over a graph.** Subscriptions deliver `added/updated/removed`
   triple-level patches, which we apply to an in-memory cache instead of re-fetching the
   full result set on every change.
3. **Agent lanes with version-control semantics.** Mutations can be isolated into named
   draft lanes (`agent:<id>`) that write to an append-only VCS journal, then **promote**
   (semantic merge by slug, carrying tag relations) or **discard** — without ever touching
   the canonical `main` graph until promotion.

The result is a working pattern for "Git-for-application-state": multiple human or AI
agents edit isolated copies of live data, preview their changes in real time, and promote
them back under deterministic semantics. Conflict detection is the highest-priority
hardening step before this should be treated as production-grade state management.

---

## 2. What we built

| Layer                  | Module(s)                                   | Responsibility                                                                                                     |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Reactive UI**        | `src/routes/+page.svelte`                   | Consumes live resources via Svelte 5 `await` + `$derived`; renders frameworks, tags, lane banner, platform status. |
| **Remote functions**   | `src/routes/{data,tags,platform}.remote.ts` | `query.live` streams, `form` mutations, `command` actions. The network boundary.                                   |
| **Platform kernel**    | `src/lib/trellis/*`                         | Reusable primitives: entity collections, diff application, live-query bridge, lane logic, error/config helpers.    |
| **Domain servers**     | `src/lib/server/*`                          | Framework/tag collections, tag-assignment entities, VCS lane engine integration.                                   |
| **Schemas + ontology** | `src/lib/schemas/*`                         | Zod validators, EQL graph queries, JSON-LD ontology registered at sidecar startup.                                 |
| **Data plane**         | Trellis sidecar (`:3920`)                   | Triple-store, EQL query engine, WebSocket diff subscriptions, ontology validation.                                 |
| **Portable runtime**   | `wc/*`, `scripts/wc-*.mjs`                  | Boots trellis-node + the app inside a WebContainer (browser-native Node).                                          |

### The two-entity reference model

The app deliberately ships **two** entity types so the "add a new type" path is proven,
not theoretical:

- `framework` — the primary entity (title, slug, sortOrder, laneId).
- `tag` — the reference second type (~60 lines end-to-end: schema → collection → remote).
- `frameworkTag` — a **sidecar-visible assignment entity** that joins the two because
  live-visible relations must cross the sidecar boundary. (More on why this is an entity
  and not a graph link in §4.4.)

---

## 3. Architecture

### 3.1 Runtime topology

```
┌────────────────────────────────────────────────────────────────┐
│ Browser (:4000)                                                  │
│                                                                  │
│  +page.svelte                                                    │
│    frameworks = getFrameworks({ lane })   ← query.live resource  │
│    {#each await frameworks as fw}         ← Svelte 5 async       │
│    <form {...addFramework}>               ← progressive-enhance   │
│    onclick={() => toggleFrameworkTag()}   ← command              │
└───────────────┬──────────────────────────────────────────────────┘
                │  SvelteKit remote-function transport (HTTP + stream)
                ▼
┌────────────────────────────────────────────────────────────────┐
│ SvelteKit server (remote functions)                              │
│                                                                  │
│  query.live ──► runLiveQueryStream() ──► async generator         │
│  form/command ─► createEntityCollection() CRUD                   │
│                    │            ▲                                │
│                    │            │ refreshAfterLaneMutation()     │
│                    ▼            │ (single-flight reconnect)      │
│            ┌───────────────────┴──────────┐                      │
│            │ $lib/trellis kernel + servers │                     │
│            └───────────┬───────────────────┘                     │
└────────────────────────┼─────────────────────────────────────────┘
         graph path       │        agent-lane path
        (main lane)       │       (agent:* + .trellis/)
                ┌─────────┴──────────┐
                ▼                    ▼
┌──────────────────────┐   ┌──────────────────────────────┐
│ Trellis sidecar :3920 │   │ VCS journals (.trellis/)      │
│  EAV triple-store     │   │  append-only lane op-logs     │
│  EQL query engine     │   │  TrellisVcsEngine materialize │
│  WS diff subscriptions│   │  promote → semantic merge     │
│  ontology validation  │   │  fs.watch + head-hash poll    │
└──────────────────────┘   └──────────────────────────────┘
```

### 3.2 Read path (live query)

```
 listFrameworks(lane)              subscribeFrameworks(lane, onUpdate)
        │                                     │
        ▼                                     ▼
 ┌─────────────┐   yield initial   ┌────────────────────────────┐
 │ async gen   │ ───────────────►  │ runLiveQueryStream          │
 │ load()      │                   │  • yield await load()       │
 └─────────────┘                   │  • for each WS diff:        │
        ▲                          │      push → queue → yield   │
        │   WS: {added,updated,    └──────────────┬──────────────┘
        │        removed}                         │ stream
        │                                         ▼
 ┌──────────────────────────┐            Svelte resource updates,
 │ applyBindingDiff(cache,…) │           UI re-renders the rows
 │  patch in place, no refetch│
 └──────────────────────────┘
```

### 3.3 Write + reconcile path

```
 form/command ─► mutate (graph OR journal) ─► refreshAfterLaneMutation(lane)
                                                     │
                        ┌────────────────────────────┴───────────────┐
                        │ main lane: reconnect main live query        │
                        │ agent lane: reconnect [lane, main] queries  │
                        └─────────────────────────────────────────────┘
```

---

## 4. How it works (mechanism deep-dive)

### 4.1 Server-streamed reactivity, zero client DB

The component never imports a database client. It calls a remote function and awaits it:

```svelte
const frameworks = $derived(getFrameworks({ lane }));
...
{#each await frameworks as framework (framework.id)}
```

`getFrameworks` is a `query.live` whose body is an **async generator**
(`runLiveQueryStream`): it `yield`s the initial snapshot, then yields again on every
subscription push. SvelteKit transports those yields to the browser and the `await`-ed
resource re-renders. All graph access, auth, and reconnection stay server-side. The wire
never exposes the triple-store or its credentials.

### 4.2 Diff-based subscriptions (the performance core)

Naïve realtime re-runs the query and ships the whole list on every change. Instead, the
Trellis subscription delivers triple-level deltas, and `applyBindingDiff` mutates a cached
array:

- `removed` rows → filtered out by entity id.
- `added` / `updated` rows → merged into the existing item (or appended).
- A `hydrateMissing` pass fills any binding that lacked `title`/`slug` with a targeted
  `read(id)` rather than a full `list()`.

This turns "N subscribers × full-list payload × every write" into "N subscribers × one
small patch." The cache only cold-loads once (`cache === null` guard with a single-flight
`refreshPromise`).

There is one explicit stopgap: tag assignments are separate entities, while the framework
list resource depends on their aggregate. Until cross-entity subscription dependencies
propagate automatically, a `tagRevision` fact on the parent framework acts as manual cache
invalidation so `query.live` receives a framework-level diff when tags change.

### 4.3 Lanes: isolation without branches of infrastructure

A lane is just a tag on the world: `main` or `agent:<id>` (`src/lib/trellis/lane.ts`).
`normalizeLaneId` coerces user input (`?lane=demo` → `agent:demo`). Two backends sit behind
the same interface (`listFrameworks` / `subscribeFrameworks`):

- **Graph-backed lanes** — entities carry a `laneId` attribute; reads filter by it.
- **Journal-backed lanes** — when `.trellis/` exists, agent-lane writes go to an
  append-only **VCS op-log** instead of the graph (`usesJournalLane`). Reads
  _materialize_ the lane by replaying integration + lane ops through `TrellisVcsEngine`
  and running EQL against the resulting store.

The UI is identical either way — the banner's **Promote** / **Discard** buttons call the
same `command`s.

### 4.4 Design rule: live-visible relations are entities

A subtle but important correctness result came out of the tag implementation: link
mutations written through an _in-process_ kernel were **not visible** to the running
sidecar (separate process, separate store). Reproducing that bug forced the rule:

- Relations that must be visible to live remote queries are modeled as sidecar-visible
  entities and written through the sidecar API.
- Relations that are purely local to an in-process graph or materialized journal may remain
  graph links.

That is why tag assignments are first-class `frameworkTag` entities
(`{ frameworkId, tagId }`) instead of in-kernel graph links. The query/subscription path
sees them immediately, and the `tagRevision` bump described in §4.2 makes the parent
framework resource refresh across tabs. The takeaway is not "links are bad"; it is that
observability boundaries determine the representation. This slightly qualifies the usual
"adding a relation is adding triples" claim: adding an observable relation still avoids a
schema migration, but it may need to become an entity so the live sidecar can see and
notify it.

### 4.5 Promote = semantic merge

`promoteLane` (`src/lib/server/trellis.ts`) is a real merge, not a copy:

1. Gather drafts (from journal materialization or graph, depending on lane type).
2. Index `main` by slug.
3. For each draft: update the existing main entity by slug, **or** create it — then
   `mergeMaterializedTagsToGraph` carries the draft's tag assignments onto the main entity.
4. Graph-lane drafts are deleted; journal lanes are promoted then dropped via the VCS engine.

So a draft lane behaves like a feature branch: edit in isolation, preview live, merge by
identity, and the relations come with it. Today that merge policy is deterministic
last-writer-wins by slug; it is not yet conflict-aware. The next hardening step is to
compare the draft's base version with current `main` at promote time and refuse silent
clobbers before building a richer conflict UI.

### 4.6 Journal liveness

Journal-backed lanes can't use the graph's WebSocket, so `subscribeLaneJournal` combines
`fs.watch` on the lane's `ops.json` with a 1.5s head-hash poll as a backstop, re-materializing
and emitting on change. Same `onUpdate` contract as the graph subscription.

### 4.7 Portable runtime (WebContainer)

`wc/server.mjs` serves a COOP/COEP-isolated page that boots **trellis-node's `dist/`** and
the app pack inside a WebContainer — Node running in the browser via WASM. This is the
seed of "the database and the app ship together to the client," tested by `wc-host.e2e.ts`
(bootstrap API) and the gated full-boot `wc-boot.e2e.ts` (`WC_E2E=1`).

---

## 5. Why it's special

Most realtime stacks give you **one** of these. This combines all four:

1. **Graph-native, not table-native.** State is EAV triples with an EQL query engine and a
   registered ontology. Adding a relation is adding facts, not a migration; if that
   relation must be live-visible across the sidecar boundary, the relation is represented
   as a first-class assignment entity.
2. **Reactivity is a server concern.** Remote functions mean the client is dumb and safe;
   the realtime contract is an async generator, not a bespoke socket protocol in every
   component.
3. **Diff-based, not snapshot-based.** Updates are triple-level patches applied to a cache.
4. **Version control for live state.** Lanes + journals + semantic promote give you
   branch/preview/merge over application data — the natural substrate for **multi-agent**
   editing where several AI or human actors propose changes concurrently.

The "agent lane" framing is the punchline: an LLM agent gets its own lane, mutates freely
via the same HTTP API a human uses, the human watches the draft update live, and promotes
or discards with one click. That is a concrete, working pattern for **human-in-the-loop
agentic editing of shared state.**

---

## 6. Competitive analysis

| Capability                  | **This stack**                  | Firebase RTDB / Firestore | Supabase Realtime      | Convex                       | Liveblocks / Yjs  | ElectricSQL / Replicache |
| --------------------------- | ------------------------------- | ------------------------- | ---------------------- | ---------------------------- | ----------------- | ------------------------ |
| Data model                  | **Graph (EAV triples)**         | Document                  | Relational (PG)        | Document/relational          | CRDT doc          | Relational sync          |
| Realtime transport          | Server-streamed remote fn       | Client SDK socket         | PG logical replication | Reactive server queries      | CRDT updates      | Shape/sync engine        |
| Client DB SDK required      | **No**                          | Yes                       | Yes                    | Yes                          | Yes               | Yes (local store)        |
| Update granularity          | **Triple diffs**                | Doc snapshots             | Row events             | Query invalidation/recompute | Op-level CRDT     | Row deltas               |
| Query language              | **EQL graph patterns**          | Path/limited              | SQL                    | JS functions                 | n/a               | SQL/shapes               |
| Branch / preview state      | **Yes (lanes)**                 | No                        | No                     | No                           | (branches = docs) | No                       |
| Semantic merge / promote    | **Yes, currently LWW by slug**  | No                        | No                     | No                           | CRDT auto-merge   | No                       |
| Multi-agent draft isolation | **First-class**                 | Manual                    | Manual                 | Manual                       | Per-doc           | Manual                   |
| Offline / portable runtime  | **WebContainer Node + Trellis** | Offline cache             | Limited                | No                           | Yes (CRDT)        | Yes (local-first)        |
| Ships DB/runtime to client  | **App + Node DB in WASM**       | No                        | No                     | No                           | n/a               | Local store + sync       |

**Where each competitor wins:** Firebase/Supabase/Convex are managed, horizontally scaled,
and production-hardened today, and Convex's reactive query model is closer to this stack
than a plain snapshot listener. Liveblocks/Yjs beat us on conflict-free concurrent text
editing (true CRDTs). ElectricSQL/Replicache beat us on offline-first relational sync with
a real local store and sync engine, which is a different claim than booting a Node database
inside WebContainer.

**Where this stack is differentiated:** nobody in the mainstream gives you _graph data +
server-streamed reactivity + Git-style lanes/promote over live state_ in one model. The
closest conceptual cousins are Dolt (versioned SQL database) and Git-for-data tools, but
those aren't realtime UI substrates. This is the only one of the set purpose-built for
**concurrent agent/human drafts on a live graph.**

---

## 7. Benchmarks

### 7.1 Sidecar latency (measured, localhost, single node)

Measured against the running Trellis sidecar on 2026-06-02 (Python `urllib`, warm process):

| Operation                                | p50     | p95     | min     | max     |
| ---------------------------------------- | ------- | ------- | ------- | ------- |
| `GET /health`                            | 1.44 ms | 3.74 ms | 1.05 ms | 20.4 ms |
| `GET /entities` (list ~40 rows)          | 0.92 ms | 1.91 ms | 0.71 ms | 3.63 ms |
| `POST /query` (graph pattern, 2 triples) | 1.17 ms | 3.74 ms | 0.69 ms | 3.76 ms |
| `POST /entities` (create + persist)      | 2.85 ms | 5.20 ms | 1.93 ms | 6.02 ms |

Reads and graph queries are **sub-2 ms p50**; writes (which persist) are **~3 ms**. These
are loopback numbers and exclude the SvelteKit remote-function hop and browser render; treat
them as a floor for the data plane, not end-to-end latency.

### 7.2 Diff vs. snapshot (analytical)

The diff path's payload per update is O(changed triples), independent of result-set size.
A naïve snapshot subscription is O(total rows) per write, per subscriber. For a list of _N_
items with _S_ subscribers and _W_ writes, snapshot fan-out moves `N·S·W` row-payloads;
the diff path moves `≈ S·W` patch-payloads. The crossover favors diffs immediately for any
N > 1 and grows linearly with list size.

### 7.3 Test + verification suite (measured)

| Check                                     | Result                                                      |
| ----------------------------------------- | ----------------------------------------------------------- |
| `pnpm check` (svelte-check)               | 497 files, **0 errors, 0 warnings**                         |
| `pnpm lint` (prettier)                    | clean                                                       |
| `pnpm build` (adapter-vercel, nodejs24.x) | passing                                                     |
| E2E (`playwright test`, serial)           | **8 passed, 1 skipped** (WC full-boot, gated) in **~3.7 s** |

> Note: the E2E suite runs single-worker by design — the specs drive one shared sidecar +
> dev server, so parallel workers race on shared state and trigger a thundering herd of
> on-demand Vite client compilation that stalls hydration. Serial execution is both correct
> and, at 3.7 s, effectively free.

### 7.4 What is _not_ benchmarked

No measured end-to-end live-update latency yet (tab A mutation submitted -> tab B row
visibly updated), no multi-node, no network RTT, no concurrent-writer contention at scale,
no large-graph (>10⁵ entity) query timings, no WebContainer cold-boot wall-clock under
load. The cross-tab live-update number is the most important next benchmark because it
tests the report's actual thesis, not just the sidecar floor.

---

## 8. Implications & use cases

The strategic thesis is the product frame: this turns "realtime database" into
"version-controlled live graph." Branches, previews, and merges belong over application
state, not just source files, if agents and humans are going to collaborate safely on live
systems. This artifact is best read as a pattern proof and reference implementation seed,
not a production-hardened sync database yet.

**Direct fits:**

- **Human-in-the-loop AI editing.** An agent proposes changes in `agent:gpt-task-42`; the
  reviewer watches the draft update live and promotes/discards. This is the headline use case.
- **Multi-agent orchestration.** Several agents each own a lane; promotes serialize their
  contributions into `main` with slug-merge semantics. A natural fit for swarm/critic loops.
- **Preview environments for data.** "Open a PR against the database" — staging content,
  config, or catalog changes with a live preview before merge.
- **Collaborative knowledge graphs.** EAV + ontology + realtime is a good substrate for
  CRMs, wikis, taxonomy/ontology editors, and internal tools where relationships matter
  more than rows.
- **Local-first / edge demos.** The WebContainer path ships the DB to the browser, useful
  for offline demos, teaching, and zero-backend prototypes.

**Strategic implications:**

- It demonstrates that **SvelteKit remote functions are a viable realtime substrate** with
  no client database SDK — a meaningfully simpler and safer client than the incumbent
  pattern.
- It reframes "realtime database" as "**version-controlled live graph**," which is the
  missing primitive for the agentic-software era: agents need branches, previews, and merges
  over _application state_, not just over source files.

---

## 9. Limitations & next steps

**Known limitations:**

- Single-node sidecar; no clustering/replication story yet.
- `promote` currently uses an unstated **last-writer-wins by slug** policy. There is no
  base-version check and no conflict UI when two lanes touch the same slug, so sequential
  promotes can silently clobber data. This is the highest-value correctness gap.
- Tags live only on `main`'s graph; lanes don't yet isolate tag drafts as fully as frameworks.
- The build emits benign `.trellis/blobs` trace warnings (adapter exposes no exclude knob).
- Benchmarks are loopback-only (see §7.4).

**Roadmap (from README "Next steps"):**

1. **Conflict detection on promote** — compare draft base-version against current `main`
   and refuse silent clobbers. This is the cheapest correctness upgrade and the precondition
   for a conflict UI.
2. **Conflict UI on promote** — surface soft/hard conflicts and let a human resolve.
3. **End-to-end live latency benchmark** — measure tab A mutation to tab B visible update.
4. **Hybrid deployment** — browser WebContainer graph + server remote functions in one topology.
5. **Journal-only tags entity** — give tags the same lane isolation frameworks have.

---

## Appendix A — File map

| Concern               | File                                              |
| --------------------- | ------------------------------------------------- |
| Live-query bridge     | `src/lib/trellis/live-query.ts`                   |
| Diff application      | `src/lib/trellis/diff.ts`                         |
| Entity collection     | `src/lib/trellis/collection.ts`                   |
| Lane logic            | `src/lib/trellis/lane.ts`                         |
| Live-query reconnect  | `src/lib/trellis/platform.ts`                     |
| Framework/tag servers | `src/lib/server/{trellis,tags,framework-tags}.ts` |
| VCS lanes + journals  | `src/lib/server/vcs-lane.ts`                      |
| Remote functions      | `src/routes/{data,tags,platform}.remote.ts`       |
| UI                    | `src/routes/+page.svelte`                         |
| WebContainer host     | `wc/server.mjs`                                   |

## Appendix B — Reproducing the benchmarks

```bash
pnpm dev:all          # sidecar on :3920
# then the latency table in §7.1:
python3 -u -c '...'   # see git history of this report / §7.1 method
pnpm exec playwright test   # §7.3 suite timings
```

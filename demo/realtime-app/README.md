# Trellis + SvelteKit Remote Functions

Graph-backed realtime app using **SvelteKit remote functions** (`query.live` + `form` + `command`) on a **Trellis** sidecar.

> 📄 **[Technical report](docs/REPORT.md)** — architecture, mechanism deep-dive, competitive analysis, and benchmarks.

## Architecture

```
Browser (:4000)
  └─ query.live({ lane }) / form / command
        └─ $lib/trellis/*  →  Trellis sidecar (:3920)
              ├─ WebSocket subscriptions (diff-based)
              ├─ Ontology validation (framework schema)
              └─ Lane-scoped draft entities
```

| Port   | Service                |
| ------ | ---------------------- |
| `4000` | SvelteKit app          |
| `3920` | Trellis DB + inspector |
| `4500` | WebContainer host      |

## Quick start

```bash
pnpm install
pnpm trellis:init      # once — DB + seed + ontology on first serve
pnpm dev:all
```

Open **http://localhost:4000**. Inspector: **http://localhost:3920**.

## Platform kernel (`$lib/trellis/`)

| Module          | Purpose                                                        |
| --------------- | -------------------------------------------------------------- |
| `collection.ts` | `createEntityCollection()` — CRUD + diff-based subscribe       |
| `diff.ts`       | Apply WS `added/updated/removed` patches without full `list()` |
| `lane.ts`       | `main` vs `agent:<id>` lane filtering                          |
| `live-query.ts` | `runLiveQueryStream()` for `query.live`                        |
| `forms.ts`      | `submitWithoutReset` for edit-in-place rows                    |

## Agent lanes (Phase 9)

Draft mutations isolated by `laneId`:

| Lane         | URL                 | Purpose             |
| ------------ | ------------------- | ------------------- |
| `main`       | `/`                 | Canonical data      |
| `agent:demo` | `/?lane=agent:demo` | Agent draft preview |

```bash
# Add draft on agent lane (UI at /?lane=agent:demo)
pnpm agent:add "astro" --lane demo

# Promote or discard from draft UI banner
```

Promote merges drafts into `main` by slug; discard deletes draft entities.

## Agent / API co-editing

```bash
pnpm agent:add "astro"              # main lane
pnpm agent:add "sketch" --lane demo # draft lane
```

Mutations via Trellis HTTP API (or MCP) sync to open tabs via `query.live`.

## Ontology (Phase 7)

Framework schema registered at sidecar startup (`framework.ontology.json` / `framework.ontology.ts`).

```bash
pnpm trellis:ontology   # manual re-register
```

## WebContainer (Phase 10)

```bash
pnpm wc:host   # → http://localhost:4500
```

Boots trellis-node + app pack in WebContainer (`npm run wc:start` inside container).

```bash
pnpm test      # includes wc-host bootstrap e2e
```

## Scripts

| Command                                  | Description                               |
| ---------------------------------------- | ----------------------------------------- |
| `pnpm dev:all`                           | Sidecar + Vite                            |
| `pnpm trellis:seed`                      | Idempotent demo seed (`laneId: main`)     |
| `pnpm trellis:dedupe`                    | Remove duplicate frameworks by slug       |
| `pnpm trellis:ontology`                  | Register framework schema                 |
| `pnpm trellis:vcs-init`                  | Initialize `.trellis/` VCS journals       |
| `pnpm lane:check -- agent:demo`          | Verify graph vs materialized lane overlay |
| `pnpm agent:add "<title>" [--lane demo]` | External mutation demo                    |
| `pnpm wc:host`                           | WebContainer harness                      |

## Graph relations (Phase 13)

Frameworks attach tags through sidecar-visible `frameworkTag` assignment entities:

```
frameworkTag:…
  frameworkId → framework:…
  tagId       → tag:…
```

| Layer                   | File                                             |
| ----------------------- | ------------------------------------------------ |
| Assignment schema + EQL | `$lib/schemas/tagged.ts`                         |
| Assignment mutations    | `$lib/server/framework-tags.ts`                  |
| UI toggle               | `toggleFrameworkTag` command in `data.remote.ts` |

Tag assignment bumps `tagRevision` on the framework entity so `query.live` subscriptions refresh across tabs. **Promote** copies tag assignments from draft frameworks onto their main-lane counterparts (by slug merge).

## VCS journal lanes (Phase 14)

Agent lanes are **journal-only** when `.trellis/` exists:

| Lane      | Writes                | Reads                                |
| --------- | --------------------- | ------------------------------------ |
| `main`    | Trellis graph sidecar | Graph + WS live query                |
| `agent:*` | VCS lane journal only | Materialized overlay + journal watch |

```bash
pnpm trellis:vcs-init   # once — .trellis/ bootstrap
pnpm agent:add "draft" --lane demo   # writes journal, not graph
pnpm lane:check -- agent:demo        # verify materialized overlay
```

Promote replays the lane journal into integration, then merges drafts onto `main` in the graph (including tag assignments).

## WebContainer E2E (Phase 15)

```bash
pnpm wc:host          # host on :4500
pnpm test:wc          # WC_E2E=1 — full boot (slow, ~3–5 min)
```

Default `pnpm test` runs app e2e only; bootstrap API test remains in `wc/wc-host.e2e.ts`.

## Adding a new entity type

The `tag` entity is the reference second type (~60 lines total):

| Layer            | File                  |
| ---------------- | --------------------- |
| Schema + EQL     | `$lib/schemas/tag.ts` |
| Collection       | `$lib/server/tags.ts` |
| Remote functions | `tags.remote.ts`      |

Steps for any new type:

1. Zod schema + EQL query with mutable bindings in `$lib/schemas/`
2. `createEntityCollection()` in `$lib/server/`
3. `query.live` + `form()` in `*.remote.ts` using `reconnectLiveQuery()` or `refreshAfterLaneMutation()` when lanes apply
4. Register ontology at sidecar startup (optional for demos)

## Platform status

The app footer shows live Trellis connectivity (`getPlatformStatus` remote query).

## Next steps

- Conflict UI when VCS promote hits soft/hard conflicts
- Hybrid deployment (browser WC graph + server remote functions)
- Journal-only tags entity (today tags stay on main graph)

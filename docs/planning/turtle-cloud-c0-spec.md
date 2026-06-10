---
title: TurtleDB Cloud C0 — managed room node
description: Spec for first managed Trellis server deploy path and metering hooks foundation.
created: 2026-06-10
updated: 2026-06-10
issue: TRL-37
parent: null
related:
  - turtle-cloud-pricing.md
  - ../ARCHITECTURE.md
  - ../../cloud/docs/turtledb.md
---

# TurtleDB Cloud C0 — managed room node

**Status:** spec  
**Issue:** TRL-37  
**Phase:** C0 (deploy) + C1 (metering hooks)  
**Out of scope:** Edge relay split (C2), backup/export (C3), global reconcile (C4), Iroh bridge (C5)

## Goal

Ship a **self-serve managed Trellis room node** per project:

```bash
npx trellis deploy --name my-app
# → https://my-app.trellis.computer  (or *.sprites.app interim)
# → API key + .trellis-db.json written locally
```

Cloud bills only when clients touch the mirror. Local-first apps keep working without deploy.

## Architecture (C0)

```text
Developer machine                    TurtleDB Cloud (C0)
─────────────────                    ────────────────────
.trellis-db.json                     Room node (1 tenant / project)
  mode: remote                         ├─ TrellisKernel mirror (SQLite)
  url, apiKey                          ├─ HTTP + /realtime WebSocket
                                       ├─ Auth (JWT + API key)
App / demo sidecar ──HTTP/WS──────────►└─ Blob store (content-addressed)
```

**Invariant:** Room node is a **durable peer**, not the authority. Wording in docs and ToS must say mirror/relay, not “hosted database as source of truth.”

### Existing code to reuse

| Piece | Location | C0 use |
| ----- | -------- | ------ |
| HTTP + WS server | `src/server/server.ts` | Room runtime |
| Multi-tenant pool | `src/server/tenancy.ts` | One tenant per project |
| Sprites deploy | `src/server/deploy.ts` | Interim host; broker wraps this |
| Fly Sprites provider | `cloud/src/providers/fly-sprite.ts` | Broker provisioning seam |
| Realtime subs | `src/server/realtime.ts` | Browser live queries |
| Client remote mode | `src/client/sdk.ts` | `TrellisDb` remote URL |

### C0 additions

| Component | Owner | Description |
| --------- | ----- | ----------- |
| **Deploy CLI polish** | `trellis-node` | `trellis deploy --name <slug>` validates name, prints URL + key; `--stub` for local dry-run |
| **Broker route** | `cloud/` | `POST /turtledb/provision { name }` → create Sprite, start server, return credentials |
| **Project registry** | `cloud/` (InstantDB) | `turtleDbProjects` entity: owner, name, url, apiKeyHash, createdAt, status |
| **Meter stub** | `trellis-node` | In-process counters per tenant (no Stripe yet) |
| **Health + status** | both | `GET /health` on room; broker `GET /turtledb/status/:id` |

## Non-goals (C0)

- Multi-region edge relay
- Automatic backup to object storage
- Custom domains (use provider subdomain)
- Usage-based billing enforcement (C1 reports only)
- Iroh transport

---

## C1 — metering hooks (same issue, phase 2)

Implement counters defined in [turtle-cloud-pricing.md](./turtle-cloud-pricing.md):

### Graph I/O

Hook points:

- `TrellisKernel` middleware after successful `assert` / `retract` / `link`
- `POST /query` and subscription re-run in `SubscriptionManager`
- Sync catch-up reads in `SyncEngine` (when graph-op sync lands on server)

### Storage

Daily cron on room node:

- Sum SQLite file size + blob dir bytes per tenant
- Emit `storage_bytes` sample

### Egress

- Wrap WebSocket `send` in `SubscriptionManager` — count JSON bytes
- Wrap `GET /files/:hash` response bodies

### Rollup

- Per-tenant daily JSONL or SQLite table: `{ date, graph_io, storage_bytes, egress_bytes }`
- Broker pulls samples via authenticated admin endpoint (C1.1)
- Stripe integration deferred to follow-up issue (C1.2)

---

## Acceptance criteria

### C0 — deploy path

- [x] `trellis deploy --name <slug> --stub` writes `.trellis-db.json` with `mode: remote` (local dry-run)
- [ ] `trellis deploy --name <slug>` completes against Sprites and writes `.trellis-db.json` with `mode: remote`
- [ ] Deployed room serves `GET /health` → 200
- [ ] Deployed room accepts `POST /entities` with API key and returns created id
- [ ] Deployed room accepts WebSocket subscribe on `/realtime` and pushes diff on mutation
- [ ] `demo/realtime-app` can point `TRELLIS_URL` at deployed room and pass smoke test (list + live add)
- [x] Broker `POST /turtledb/provision` creates registry row linked to authenticated user (stub mode; `cloud/src/turtledb/`)
- [ ] Broker live provision (`TURTLEDB_PROVISION_LIVE=1`) completes against Sprites
- [ ] Docs: link from `docs/planning/turtle-cloud-pricing.md` and `cloud/docs/turtledb.md`

### C1 — metering

- [x] `TenantPool` / server records `graph_io` increment on write + query (testable via unit test with mock meter)
- [x] Daily storage sampler returns byte totals per tenant (integration test with temp db + blob dir)
- [x] Egress counter increments on WS send (unit test)
- [x] `GET /admin/usage?tenant=<id>` returns day-bucket totals (auth: admin API key only)
- [x] test: `bun test test/cloud/usage-meter.test.ts` (new)

---

## API sketch (broker)

### `POST /turtledb/provision`

Request:

```json
{ "name": "my-app", "region": "auto" }
```

Response:

```json
{
  "projectId": "…",
  "url": "https://my-app.sprites.app",
  "apiKey": "spk_…",
  "status": "ready"
}
```

Errors: `409 name_taken`, `403 plan_limit`, `503 provider_unavailable`

### `GET /turtledb/projects`

Lists current user's provisioned projects (no apiKey in response — rotate via separate route later).

---

## Security

- API keys hashed at rest in broker registry (show once on provision)
- Room node validates `Authorization: Bearer <apiKey>` or JWT
- Admin usage endpoint requires separate `TURTLEDB_ADMIN_KEY`
- One tenant id per project slug; no cross-tenant pool leakage (existing `TenantPool` isolation)

---

## Rollout

1. **Internal dogfood** — deploy `demo/realtime-app` sidecar to Sprite via CLI
2. **Broker alpha** — Studio superadmin can provision from dashboard tile
3. **Public hobby tier** — rate limit + 1 project cap before Stripe

---

## Follow-up issues (not TRL-37)

| Phase | Title | Depends on |
| ----- | ----- | ---------- |
| C1.2 | Stripe meters for TurtleDB | TRL-37 C1 counters |
| C2 | Edge relay split from room node | TRL-37 C0 |
| C3 | Backup / export to object storage | C0 |
| C4 | Multi-region room reconcile | C2, TRL-11/12 |
| C5 | Iroh relay assist | TRL-12 |

---

## Test plan

```bash
# Local
bun test test/cloud/

# Manual smoke
npx trellis deploy --name trellis-smoke-$(date +%s)
TRELLIS_URL=https://….sprites.app TRELLIS_API_KEY=spk_… pnpm --dir demo/realtime-app dev:sidecar
curl -s "$TRELLIS_URL/health"
```

---

## References

- Pricing meters: [turtle-cloud-pricing.md](./turtle-cloud-pricing.md)
- Deploy implementation: `src/server/deploy.ts`
- Cloud broker: `cloud/src/server.ts`, `cloud/src/providers/fly-sprite.ts`
- Compatibility adapters: `apps/docs/content/3.architecture/4.compatibility-adapters.md`

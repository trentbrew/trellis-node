---
title: Remote MCP gateway
description: Spec for Trellis Room MCP — shared graph access for third-party AI agents over Streamable HTTP.
created: 2026-06-15
status: draft
phase: 3-hosted-product
related:
  - ../adr/0012-graph-overlay-config-surface.md
  - ../essays/graph-overlay-one-surface.md
---

# Remote MCP gateway

Mount MCP (Streamable HTTP) on Trellis room nodes so Claude, ChatGPT, Cursor, and other MCP clients can **query and CRUD one shared graph** over the wire — without a local checkout or stdio subprocess.

## Problem

| Surface today | Remote? | Gap |
| ------------- | ------- | --- |
| trellis-graph MCP (trellis-client) | Local only (`localhost:1414`) | 48 tools, no hosted URL |
| TurtleDB REST/WS (`trellis db serve`) | Yes | No MCP — agents need SDK or raw HTTP |
| trellis-vcs MCP (`src/mcp/`) | stdio + broken SSE | Repo-scoped, not room graph |

Playground proves remote **UI → graph**. Remote MCP proves remote **agents → same graph**.

## Decision

**MCP is a capability surface on the room server** — same kernel as `/entities`, `/query`, `/realtime`. Not a second API or a new data model.

```
https://<room>/mcp          Streamable HTTP (primary)
https://<room>/entities     REST (SDK)
https://<room>/realtime     WebSocket subscriptions
```

## Phase 0 — Spike (this PR)

**Shipped:**

- `POST/GET/DELETE /mcp` on `trellis db serve`
- Tools: `graph_health`, `query_graph`, `get_node`, `create_node`, `update_node`, `delete_node`
- Session-based `WebStandardStreamableHTTPServerTransport`
- CORS headers for MCP (`mcp-session-id`, `mcp-protocol-version`, …)
- `test/server/mcp-gateway.test.ts`

**Cursor config (local room):**

```json
{
  "mcpServers": {
    "trellis-room": {
      "url": "http://localhost:3920/mcp"
    }
  }
}
```

With API key:

```json
{
  "mcpServers": {
    "trellis-room": {
      "url": "https://my-room.sprites.app/mcp",
      "headers": {
        "Authorization": "Bearer spk_..."
      }
    }
  }
}
```

## Phase 1 — Deploy + bridge

**Shipped:**

- MCP bundled in `trellis deploy` via `startServer` (same `/mcp` route as local serve)
- `trellis mcp bridge --room <url>` — stdio proxy for Claude Desktop / stdio-only clients
- Permission checks on writes (reuse `PermissionRegistry` in `src/mcp/room.ts`)
- Deploy success output includes MCP URL + Cursor / Claude config snippets
- `GET /health` includes `mcp: "/mcp"` for discovery
- `test/mcp/bridge.test.ts`

**Cursor config (deployed room):** same as Phase 0 `url` + `Authorization` header.

**Claude Desktop (stdio bridge):**

```json
{
  "mcpServers": {
    "trellis-room": {
      "command": "npx",
      "args": [
        "trellis",
        "mcp",
        "bridge",
        "--room",
        "https://my-room.sprites.app",
        "--api-key",
        "spk_..."
      ]
    }
  }
}
```

## Phase 2 — Agent ergonomics

**Shipped:**

- `get_graph_summary` — compact introspection (health, types, ontologies, attrs, links, recent ops)
- `link_nodes` — semantic relations between entities
- Lane param + `X-Trellis-Lane` header on writes (`agent:<client-id>` op attribution)
- **Playground tenant targeting** — optional `tenantId` / `room` on all graph tools; `X-Trellis-Tenant` header; bridge `--playground-room` / `--tenant` (`embed-{slug}` matches `?room=` on playground.trellis.computer)
- Rate limiting via `UsageMeter.assertGraphIoBudget` (`TRELLIS_MCP_GRAPH_IO_LIMIT`)
- trellis-graph skill: `TRELLIS_ROOM_URL` + remote tool parity documented
- `test/mcp/graph-summary.test.ts` + extended gateway tests

## Acceptance criteria (Phase 2)

- [x] `get_graph_summary` returns compact overview
- [x] `link_nodes` creates relations with lane attribution
- [x] Write tools accept `lane` param
- [x] Graph tools accept `tenantId` / `room` for Playground `embed-{slug}` tenants
- [x] Rate limit enforced when `TRELLIS_MCP_GRAPH_IO_LIMIT` set
- [x] Remote room dogfood: MCP write visible in Playground (`cursor-dogfood-test` / `mcp-dogfood`, verified 2026-06-29)

## Phase 3 — Hosted product

**Shipped:**

- Discovery MCP at `/gateway/mcp` on room servers + `trellis mcp gateway serve`
- Tools: `list_rooms`, `get_room`, `connect_room` (Cursor / Claude config snippets)
- Room registry: `~/.trellis/vm.json`, `.trellis-db.json`, `.trellis-rooms.json`, `TRELLIS_MCP_GATEWAY_ROOMS`
- OAuth metadata: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`
- Service doc: `GET /.well-known/trellis-mcp`
- MCP write audit: `Decision` entities with `agent:<client-id>` attribution
- Deploy tracks sprites in `~/.trellis/vm.json` for discovery

**Deploy to Sprites:**

```bash
# From desk root — merges ~/.trellis/vm.json + .trellis-db.json into room registry
trellis mcp gateway deploy --name mcp-gateway --public-url https://mcp.trellis.computer

# Dry-run
trellis mcp gateway deploy --name mcp-gateway --stub
```

Then point **`mcp.trellis.computer`** at the gateway. Sprites does not issue TLS for custom hostnames — use one of:

**A. Vercel reverse proxy (recommended if you already proxy on Vercel)**

Deploy `trellis-node/apps/mcp-gateway-proxy/` — external rewrite to the Sprite origin:

```bash
cd trellis-node/apps/mcp-gateway-proxy
vercel link   # new project, e.g. trellis-mcp-gateway
vercel --prod
```

1. Vercel project → **Domains** → add `mcp.trellis.computer`
2. Namecheap: change `mcp` CNAME from `*.sprites.app` → **Vercel DNS target** (same pattern as `playground` / `studio`)
3. Update `vercel.json` `destination` if the Sprite hostname changes after redeploy

Cursor: `{ "url": "https://mcp.trellis.computer/gateway/mcp" }`

**B. Direct CNAME to Sprites** — DNS resolves, but HTTPS on the vanity host fails until Sprites adds custom domains. Use the Sprite origin URL in clients until then.

**Local dev:**

```bash
trellis mcp gateway serve --port 3940 --public-url https://mcp.trellis.computer
```

**Cursor discovery config:**

```json
{
  "mcpServers": {
    "trellis-gateway": {
      "url": "https://mcp.trellis.computer/mcp"
    }
  }
}
```

Then `list_rooms` → `connect_room` → point graph client at room `/mcp`.

## Acceptance criteria (Phase 3)

- [x] `list_rooms` / `get_room` / `connect_room` on `/gateway/mcp`
- [x] OAuth well-known endpoints on room server
- [x] MCP writes emit `Decision` audit entities
- [x] `trellis mcp gateway serve` for hosted discovery
- [x] `trellis mcp gateway serve` for hosted discovery
- [x] `trellis mcp gateway deploy` — Sprites bundle + room registry upload
- [x] `mcp.trellis.computer` DNS CNAME → Vercel proxy → Sprite (verified 2026-06-29: `/health`, `/gateway/mcp`, `list_rooms`)

## Campus convergence (Phase 4) — not retiring the analogy

Phase 4 **does not** retire the campus mental model (facilities, zones, lanes, agents).
It retires **duplicate implementation surfaces**:

| Keep | Converge / retire |
| ---- | ----------------- |
| Campus ontology (facility, zone, agent, wallet, decision, artifact) | Duplicate trellis-graph MCP in trellis-client (48 tools on localhost only) |
| Spatial authority model in graph | Second HTTP stack parallel to room kernel |
| Lane / promote semantics | — |

**Target:** one EAV room kernel; campus types become **ontology on that kernel**;
MCP + Playground + REST share one graph. Agents still think in zones and facilities —
they just query one remote room instead of a separate local Nuxt graph process.

## Phase 4 — Convergence (implementation)

- Retire duplicate local-only graph MCP in trellis-client
- Campus zones/facilities as room ontology
- MCP resources for pollable subscriptions

## Non-goals (V1)

- Merging trellis-vcs MCP into room MCP (separate concerns)
- Iroh P2P transport (TRL-12)
- 48-tool parity on day one (~12 tools + `get_graph_summary`)

## Architecture constraints

1. **Room does not own state** — relay/accelerator; local op-log remains canonical.
2. **One graph, many surfaces** — Playground, MCP, REST, WS share one kernel (ADR 0012).
3. **Auth on every tool call** — same `AuthContext` path as REST.
4. **Lane-aware agent writes** — default draft lane; promote is explicit.

## Acceptance criteria (Phase 0)

- [x] `POST /mcp` exposes Streamable HTTP MCP on db serve
- [x] Tools: `graph_health`, `query_graph`, `get_node`, `create_node`, `update_node`, `delete_node`
- [x] `test/server/mcp-gateway.test.ts` passes
- [x] Cursor connects and mutates data visible in Playground (dogfood script + Playground UI verified 2026-06-29)

## Dogfood runbook (Path A)

Prove **agent write → Playground UI** on the same tenant (`embed-{room}`).

### 1. Find your room URL

Not the Playground UI — the **TurtleDB Sprite** behind it:

```bash
cat ~/.trellis/vm.json          # sprites with hasTrellis + apiKey
cat .trellis-db.json            # project deploy URL
curl -s "$ROOM_URL/health" | jq  # confirms mcp paths
```

Sprites hosts use **`/trellis/mcp`** (Sprites reserves `/mcp`). Local `db serve` uses **`/mcp`**.

### 2. Automated smoke (CLI)

```bash
export TRELLIS_ROOM_URL=https://fractals-demo-0610-bnsoz.sprites.app
export TRELLIS_API_KEY=spk_…
export TRELLIS_PLAYGROUND_ROOM=dogfood-$(whoami)-$(date +%m%d)

node scripts/mcp-dogfood.mjs
```

Script calls `get_graph_summary` + `create_collection_record` on tenant `embed-{room}` and prints the Playground URL to verify.

### 3. Cursor MCP config (remote URL)

Match your room slug from the URL bar (`?room=…`):

```json
{
  "mcpServers": {
    "trellis-room": {
      "url": "https://YOUR-ROOM.sprites.app/trellis/mcp",
      "headers": {
        "Authorization": "Bearer spk_…"
      }
    }
  }
}
```

Or stdio bridge with playground tenant pinned:

```json
{
  "mcpServers": {
    "trellis-room": {
      "command": "npx",
      "args": [
        "trellis", "mcp", "bridge",
        "--room", "https://YOUR-ROOM.sprites.app",
        "--api-key", "spk_…",
        "--playground-room", "YOUR-ROOM-SLUG"
      ]
    }
  }
}
```

### 4. Agent prompt (in Cursor)

```
1. Call get_graph_summary with room "<YOUR-ROOM-SLUG>"
2. Call create_collection_record:
   - room: "<YOUR-ROOM-SLUG>"
   - collectionSlug: "agent-notes"
   - title: "Hello from Cursor MCP"
   - ensureCollection: true
   - collectionTitle: "Agent notes"
3. Tell me the record id returned
```

### 5. Pass criteria

- [x] Playground at `https://playground.trellis.computer/?room=cursor-dogfood-test` shows MCP Dogfood rows (verified Playwright + REST)
- [x] `get_graph_summary` tenant matches URL `?room=` slug (`embed-cursor-dogfood-test`)
- [ ] Optional: second agent (Claude bridge) sees the same row on the same `room` slug

## Wedge complete (2026-06-29)

Phases 0–3 shipped. Dogfood PASS. `mcp.trellis.computer` live.

**Cursor (discovery):** `{ "url": "https://mcp.trellis.computer/gateway/mcp" }` → `list_rooms` → `connect_room`.

**Cursor (room graph):** room `…/trellis/mcp` on `*.sprites.app` (local `db serve` uses `…/mcp`).

**Ship:** milestone `milestone:ee4b08b6763c` — "Remote MCP: dogfood PASS + mcp.trellis.computer discovery live" (2026-06-29)

**Follow-up:** Redeploy gateway Sprite for registry `mcpUrl` fix; Phase 4 campus convergence.

Create Trellis-VCS issue when `.trellis` is initialized:

```bash
trellis issue create -t "Remote MCP gateway for Trellis rooms" \
  -P high -l mcp,remote,graph \
  --desc "Mount MCP on room nodes for third-party agent graph access." \
  --ac "POST /mcp on db serve" \
  --ac "Core graph tools + tests" \
  --ac "trellis deploy bundles /mcp" \
  --ac "trellis mcp bridge for stdio clients"
```

## References

- MCP Streamable HTTP: `@modelcontextprotocol/sdk` `WebStandardStreamableHTTPServerTransport`
- Existing room server: `src/server/server.ts`
- Tool implementation: `src/mcp/room.ts`
- Graph summary: `src/mcp/graph-summary.ts`
- Gateway sessions: `src/server/mcp-gateway.ts`
- stdio bridge: `src/mcp/bridge.ts`
- Discovery: `src/mcp/discovery.ts`, `src/mcp/room-registry.ts`
- Gateway serve: `src/mcp/gateway-serve.ts`

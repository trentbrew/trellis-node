# Typed SDK + realtime parity (React, Vue, Svelte)

**Issue:** TRL-35 · **ADR:** [0011 app shell three bands](./adr/0011-app-shell-three-bands.md)

Code-as-configuration posture for v1: app source defines schemas, routes, and
projections. No visual builder or operator overlay on this critical path.

## Stable public entrypoints

| Concern | Import | Notes |
| ------- | ------ | ----- |
| Schema | `trellis/schema` | `defineType`, `InferType`, `entityMutations` |
| Client | `trellis/client/sdk` | `TrellisDb` — remote HTTP + `/realtime` WebSocket |
| Typed reads/writes (React) | `trellis/react/typed` | `useEntities`, `useEntity`, `useMutation` |
| Typed reads/writes (Vue) | `trellis/vue/typed` | Same surface as React |
| Typed reads/writes (Svelte) | `trellis/svelte/typed` | `entitiesStore`, `mutations` |
| Realtime room (React) | `trellis/react/realtime` | `useRoom`, `useSignal` — browser-safe |
| Realtime room (Vue) | `trellis/vue` | `useRoom`, composables |
| Realtime room (Svelte) | `trellis/svelte` | `createRoom`, `toStore` |
| Primitives | `trellis/realtime` | `joinPresence`, `PersistentChannel`, `RealtimeText`, transports |

**Do not import** `trellis/react` root in browser demos — it may pull Node-only
paths. Use `trellis/react/realtime` + `trellis/react/typed`.

### Mutation semantics (today)

Typed `create` / `update` / `remove` call `TrellisDb` HTTP APIs and **resolve
when the server confirms** the write. There is **no optimistic local apply** and
no automatic rollback UI on reject — that is **future work** (SPEC-v1.1+).

```typescript
// All frameworks delegate here:
import { entityMutations } from 'trellis/schema';
await entityMutations(client, MyType).create({ title: 'Hello' });
```

Subscriptions push server-hydrated rows over WebSocket; cross-tab sync is
server-authoritative.

## Reference apps

| Demo | Path | Framework mounts | What it proves |
| ---- | ---- | ---------------- | -------------- |
| **graph-nav** | `examples/graph-nav` | React · Vue · Svelte | `defineType` → `registerType` → typed live entities + mutations, `resolve` |
| **universal-presence** | `examples/universal-presence` | React · Vue · Svelte × 3 primitives | `joinPresence`, `PersistentChannel` (chat), `RealtimeText` |
| **Integration harness** | `demo/realtime-app` | SvelteKit | Collections + chat on typed SDK (not parity matrix) |

### Run

```bash
# From trellis-node root
just graph-nav           # typed nav :4200
just universal-presence  # presence/chat/text :4100 + relay :8231
```

## Parity matrix (TRL-35)

| Acceptance criterion | Evidence |
| -------------------- | -------- |
| R/V/S typed entities + mutations, same schema | `examples/graph-nav/schema.ts` shared; hooks per framework in README |
| R/V/S presence, chat, text | `examples/universal-presence/{react,vue,svelte,...}` |
| Cross-tab / cross-browser sync | See [Automated tests](#automated-tests) + [Manual QA](#manual-qa) |
| Reconnect documented | See [Reconnect behavior](#reconnect-behavior) |
| Stable entrypoints + server-confirmed mutations | This document |

## Automated tests

```bash
npx vitest run test/schema test/realtime test/client
```

| Test file | Covers |
| --------- | ------ |
| `test/schema/graph-nav-sync.test.ts` | Two `TrellisDb` clients — subscription + `liveEntities` cross-client create |
| `test/schema/typed-adapters.test.ts` | Typed adapter wiring |
| `test/realtime/adapters.contract.test.ts` | Vue + Svelte adapters on one `MemoryHub` |
| `test/realtime/persistent-channel.test.ts` | Chat channel grow-only + replay |
| `test/realtime/text-sync.test.ts` | `RealtimeText` CRDT convergence |
| `test/realtime/presence.test.ts` | Presence join/leave/update |
| `test/client/ws-guard.test.ts` | Single WebSocket when many `subscribe()` race |

## Reconnect behavior

| Layer | Auto-reconnect? | Notes |
| ----- | --------------- | ----- |
| **Relay transport** (`joinPresence` + `VITE_PRESENCE_RELAY_URL`) | Yes | Backoff in `durable-object-relay-transport` / PartyKit adapter; room replays via `RelayPersistence` where configured |
| **`TrellisDb` WebSocket** (`subscribe`, typed `entitiesStore`) | **No (v1)** | On `close`, socket is cleared; subscriptions are **not** auto-resubscribed. App must call `subscribe` again after reconnect or avoid `disconnect()` during transient blips |
| **`TrellisClient` VCS sync** | Optional | `reconnect: true` on PartyKit transport — peer sync, not explorer typed reads |

**Practical guidance:** presence/chat/text demos use the relay layer (reconnect
friendly). graph-nav typed entities use `TrellisDb` — treat long-lived pages as
needing a future reconnect+resubscribe helper (backlog, not TRL-35 scope).

## Manual QA

### graph-nav (typed entities)

1. `just graph-nav` → open `/react/` and `/svelte/` (or Vue) in two tabs.
2. Add a nav item in one tab — appears in the other without refresh.

### universal-presence

1. `just universal-presence` → open presence + chat + text for two frameworks.
2. Confirm cursors, messages, and shared text converge.
3. Optional: two browsers via relay (default in `dev:all`).

Checklist lives in `examples/universal-presence/README.md`.

## Minimal typed app shape

```typescript
// schema.ts
import { defineType } from 'trellis/schema';
import { z } from 'zod';

export const Todo = defineType('Todo', { title: z.string() }, { title: 'title' });

// bootstrap.ts
await client.registerType(Todo);

// React
const todos = useEntities(client, Todo);
const mut = useMutation(Todo);

// Vue — useEntities / useMutation from trellis/vue/typed
// Svelte — entitiesStore / mutations from trellis/svelte/typed
```

## Deferred (not TRL-35)

- Optimistic mutations + ACK/reject protocol
- `TrellisDb` reconnect + resubscribe
- New framework helper APIs (use existing entrypoints only)
- Fractal shell / operator overlay / visual route builder

## Related

- [graph-nav README](../examples/graph-nav/README.md)
- [universal-presence README](../examples/universal-presence/README.md)
- [ontology glossary](./ontology-glossary.md)
- [Explorer sketchpad](../demo/realtime-app/EXPLORER.md)

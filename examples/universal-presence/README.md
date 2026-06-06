# Universal Presence

One realtime SDK, three framework adapters, **zero server**.

This example proves the cross-framework contract: React, Vue, and Svelte each
mount the *same* `RealtimeRoom` through their thin adapter and join the *same*
BroadcastChannel room. Move a cursor in the React tab and it shows up in the Vue
and Svelte tabs — and vice versa.

```
React  →  trellis/react/realtime ┐
Vue    →  trellis/vue             ├─→ joinPresence() → RealtimeRoom → BroadcastChannelTransport
Svelte →  trellis/svelte          ┘
```

> React uses `trellis/react/realtime` (the browser-safe realtime entry). The
> `trellis/react` root barrel also exports the DB/SSR hooks (`useQuery`,
> `useMutation`, …), whose module graph imports Node `fs` — fine for SSR, but it
> would break a browser-only bundle. Vue and Svelte have no such split: their
> packages are realtime-only.

The only per-framework code is the ~20-line mount in `react/`, `vue/`, and
`svelte/`. Engine, transport, room, and presence semantics are identical —
that's the whole point.

## Run

```sh
# from this directory (the trellis package is linked via file:../..)
npm install
npm run dev
```

Then open the three tabs:

- http://localhost:4100/react/
- http://localhost:4100/vue/
- http://localhost:4100/svelte/

(Or the landing page at http://localhost:4100/ which links all three.)

> **Scope of the default:** `BroadcastChannel` bridges tabs/windows within **one
> browser instance** only. It does *not* cross to a different browser (Chrome ↔
> Safari) or a different device — that's not a bug, it's the zero-server free
> tier. For cross-browser / cross-device, add a relay (below).

> If `trellis/*` fails to resolve, build the package once from the repo root:
> `npm install && npm run build` — the adapters are published from `dist/`.

## Cross-browser / cross-device (add a relay)

A relay is a dumb, room-scoped WebSocket fan-out. `joinPresence` swaps
`BroadcastChannelTransport` for `DurableObjectRelayTransport` the moment a
`relayUrl` is present — no other code changes.

Run the bundled local relay (uses `createRealtimeRelay` from `trellis/server`),
then point the dev server at it:

```sh
# terminal 1 — start the relay (ws://localhost:8231/rt)
npm run relay

# terminal 2 — run the demo against it
VITE_PRESENCE_RELAY_URL=ws://localhost:8231/rt npm run dev
```

Now open the tabs in **different browsers** (or on other devices on your LAN via
`ws://<your-ip>:8231/rt`) and cursors sync across all of them. `joinPresence`
appends the room id, so the client actually connects to
`ws://localhost:8231/rt/universal-demo` and the relay isolates that room from any
other.

For a hosted production relay, deploy the reference Cloudflare Durable Object at
`demo/durable-object-relay/worker.ts` and use its `wss://…` URL instead.

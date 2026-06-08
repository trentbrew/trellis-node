# Universal Realtime

One realtime SDK, three framework adapters, three demo primitives.

| Demo | Primitive | What it exercises |
|------|-----------|-------------------|
| **Presence** | `joinPresence` + presence state | Ephemeral cursors, transport selection |
| **Chat** | `PersistentChannel` | Grow-only set, localStorage replica, relay replay |
| **Text** | `RealtimeText` | RGA CRDT, `onChange` callbacks, state sync |

Each demo has React, Vue, and Svelte mounts that join the **same logical room** for that demo. Open all three framework tabs and they sync live.

```
React  →  trellis/react/realtime ┐
Vue    →  trellis/vue             ├─→ joinPresence() → RealtimeRoom → transport
Svelte →  trellis/svelte          ┘
         PersistentChannel / RealtimeText hang off the same room
```

> React uses `trellis/react/realtime` (browser-safe). The `trellis/react` root barrel also exports DB/SSR hooks that pull in Node `fs`.

## Run

```sh
npm install
npm run dev
```

Landing page: http://localhost:4100/

| Demo | React | Vue | Svelte |
|------|-------|-----|--------|
| Presence | [/react/](http://localhost:4100/react/) | [/vue/](http://localhost:4100/vue/) | [/svelte/](http://localhost:4100/svelte/) |
| Chat | [/chat/react/](http://localhost:4100/chat/react/) | [/chat/vue/](http://localhost:4100/chat/vue/) | [/chat/svelte/](http://localhost:4100/chat/svelte/) |
| Text | [/text/react/](http://localhost:4100/text/react/) | [/text/vue/](http://localhost:4100/text/vue/) | [/text/svelte/](http://localhost:4100/text/svelte/) |

> If `trellis/*` fails to resolve, build once from the repo root: `npm run build`

## Cross-browser (relay)

BroadcastChannel only bridges tabs in **one browser**. For Chrome ↔ Safari or cross-device:

```sh
# terminal 1
npm run relay

# terminal 2
VITE_PRESENCE_RELAY_URL=ws://localhost:8231/rt npm run dev
```

`joinPresence` appends the room id → `ws://localhost:8231/rt/universal-chat` (etc.).

## Gaps surfaced by these demos

| Gap | Where it shows up | Notes |
|-----|-------------------|-------|
| `RealtimeText` uses callbacks, not `Signal` | Text demo | React/Vue wire `onChange` + local state; unlike `PersistentChannel.messages` which binds via `useSignal` / `toStore` |
| React room is `null` briefly on mount | Chat demo | `PersistentChannel` must be created in `useEffect` after `useRoom` resolves — can't call `useSignal(chat.messages)` unconditionally |
| No `usePersistentChannel` helper | Chat demo | Each framework wires ~15 lines manually — candidate for a thin shared hook |
| `resolveMeta` reads presence at receive time | Chat demo | Sender name/color captured from `room.getPresence()` — stale if peer left before message arrives (meta on send is the fix, already used on `send()`) |

## QA checklist

- [ ] Presence: three framework tabs, cursors sync (same browser)
- [ ] Chat: send from React, appears in Vue + Svelte; refresh tab, history repaints from localStorage
- [ ] Text: type concurrently in two tabs, CRDT converges (no clobber)
- [ ] Relay mode: repeat chat + text across two browsers

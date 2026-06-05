# Trellis Realtime — Demos

Four multiplayer primitives built on `trellis/realtime`, the ephemeral
presence + broadcast layer. Unlike the VCS op log, realtime data is
mesh-broadcast and **never written to the persisted causal history** — the
right home for high-frequency, disposable signals.

| Demo | Primitive | What it shows |
| ---- | --------- | ------------- |
| **Active avatars** | presence | Live roster of connected peers (name + color), join/leave |
| **Chat** | broadcast | Fire-and-forget messages on a channel + typing indicator |
| **Live cursors** | presence | Cursor position published at pointer-move rate, rendered per peer |
| **Text editor** | `RealtimeText` | RGA-style sequence CRDT — concurrent edits converge |

## Docs site embed (trellis.computer)

Copy the browser bundle and embed-friendly demo into the public docs site:

```bash
just docs-realtime-sync
# or: TRELLIS_DOCS_WWW=/path/to/trellis-docs/www node scripts/sync-realtime-docs.mjs
```

Serves at `/demos/realtime/index.html?embed=1` (simulated room only; no relay on static hosting).

## Run it

From the repo root (recommended — **impolite about ports**: kills anything on
`8231` before serving):

```bash
just realtime-demo              # default port 8231, opens browser
just realtime-demo 8242         # different port, still no sharing
just realtime-stop              # evict the demo server
just realtime-test              # unit tests
```

Manual path (ES modules need HTTP — `file://` won't work):

```bash
npm run build:realtime-bundle      # → dist/realtime.bundle.js
node demo/realtime/serve.mjs 8231  # static server
# open http://localhost:8231/demo/realtime/index.html
```

### Modes

- **Simulated room** (default): several peers run in this one page over an
  in-process `MemoryHub`. Everything is multiplayer without a server or a
  second tab — ideal for a quick look.
- **Live relay** (`Switch to live relay ↗`): each tab/window is one peer.
  Messages go through `ws://localhost:<port>/rt` so **different browsers**
  (Firefox, Chrome, Safari, Edge) all sync. Display name comes from
  `navigator.userAgent`. Same origin on every window (`localhost`, not
  `127.0.0.1`).
- **Session persistence** (live mode only): the relay keeps an in-memory tail
  of chat, the latest collaborative text snapshot, and last-known presence.
  New connections receive a `replay` batch after their first `hello`. State
  survives refresh and late joiners until you restart `just realtime-demo`.
  For durable history, use the Trellis VCS op log — realtime stays ephemeral
  by design.

## API sketch

```ts
import {
  RealtimeRoom,
  RealtimeText,
  BroadcastChannelTransport,
  WebSocketRelayTransport,
} from 'trellis/realtime';

const room = RealtimeRoom.join({
  transport: new BroadcastChannelTransport({ id: myId, channel: 'room:42' }),
  initialPresence: { name: 'Ada', color: '#6d5bfa' },
});

room.onPresence((peers) => renderAvatars(peers)); // avatars
room.setPresence({ cursor: { x, y } });            // cursors
room.broadcast('chat', 'message', { text });       // chat
room.on('chat', (e) => appendMessage(e.payload));

const doc = new RealtimeText({ peerId: myId, room }); // collaborative text
doc.onChange((text) => (textarea.value = text));
```

For a real server-backed room, swap `BroadcastChannelTransport` for
`WebSocketRelayTransport` and point it at a relay URL such as
`ws://localhost:8231/rt`.

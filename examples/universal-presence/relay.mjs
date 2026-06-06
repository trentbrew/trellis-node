/**
 * Local presence relay for cross-browser / cross-device sync.
 *
 * BroadcastChannel (the demo default) only bridges tabs within ONE browser.
 * To fan presence across different browsers or machines you need a relay — a
 * dumb WebSocket fan-out, room-scoped. This is the local stand-in for the
 * hosted Durable Object relay; the client code is identical either way.
 *
 *   1. node relay.mjs                       # ws://localhost:8231/rt
 *   2. VITE_PRESENCE_RELAY_URL=ws://localhost:8231/rt npm run dev
 *
 * `joinPresence({ relayUrl })` appends the room (→ ws://localhost:8231/rt/<room>),
 * so every framework tab — in any browser — lands in the same room and syncs.
 */
import { createRealtimeRelay } from 'trellis/server';

const port = Number(process.env.PORT ?? 8231);
const relay = await createRealtimeRelay({ port, path: '/rt' });

console.log(`presence relay listening on ws://localhost:${relay.port}/rt`);
console.log('point the demo at it:');
console.log(
  `  VITE_PRESENCE_RELAY_URL=ws://localhost:${relay.port}/rt npm run dev\n`,
);

const shutdown = async () => {
  await relay.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

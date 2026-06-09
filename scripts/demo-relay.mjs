/**
 * Shared local presence relay for cross-browser / cross-device demo sync.
 *
 *   node scripts/demo-relay.mjs              # ws://localhost:8231/rt
 *   RELAY_PORT=8232 node scripts/demo-relay.mjs
 *
 * Point demos at it with VITE_PRESENCE_RELAY_URL=ws://localhost:8231/rt
 */
import { createRealtimeRelay } from 'trellis/server';

const port = Number(process.env.PORT ?? process.env.RELAY_PORT ?? 8231);
const relay = await createRealtimeRelay({ port, path: '/rt' });

console.log(`presence relay listening on ws://localhost:${relay.port}/rt`);
console.log('demos auto-wire when started via just dev:all / just universal-presence');

const shutdown = async () => {
  await relay.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

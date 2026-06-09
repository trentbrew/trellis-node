/**
 * Local Trellis entity server for the graph-nav demo.
 *
 * Unlike the presence relay (a dumb WS fan-out), this is the real Trellis DB
 * server: REST `/entities` + `/query`, the new `/ontologies` registration
 * route, and the `/realtime` WebSocket that powers live query subscriptions.
 *
 *   node server.mjs                 # http://localhost:8230  (ws: /realtime)
 *
 * The Vite dev server proxies /entities, /query, /ontologies and /realtime here,
 * so the browser talks to one origin and there's no CORS to configure.
 */
import { startServer, TenantPool } from 'trellis/server';
import { defaultLocalConfig } from 'trellis/client';

const port = Number(process.env.TRELLIS_PORT ?? 8230);
const dbPath = process.env.TRELLIS_DB ?? './.graph-nav-db';

const config = defaultLocalConfig(dbPath);
const pool = new TenantPool(config.dbPath ?? dbPath);

// `pool.get()` uses Bun's built-in sqlite; preload picks the cross-runtime
// backend (better-sqlite3 / sql.js) so `node server.mjs` works too.
await pool.preload();

const server = await startServer({ port, config, pool });

console.log(`graph-nav server → http://localhost:${port}`);
console.log(`  REST   /entities  /query  /ontologies`);
console.log(`  WS     ws://localhost:${port}/realtime  (live subscriptions)`);

const shutdown = async () => {
  try {
    await server.stop?.();
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

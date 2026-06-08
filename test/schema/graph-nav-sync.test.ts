/**
 * Cross-client live sync — the graph-nav "second tab" contract.
 *
 * Two remote TrellisDb clients share one in-process server. Client A subscribes
 * to NavSection entities; client B creates one. A's subscription must receive
 * the new server-hydrated entity row without polling.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { TrellisDb } from '../../src/client/sdk.js';
import { startServer } from '../../src/server/server.js';
import { TenantPool } from '../../src/server/tenancy.js';
import { defaultLocalConfig } from '../../src/client/config.js';
import type { TrellisHttpServer } from '../../src/server/server-shared.js';
import { bindingEntityId } from '../../src/schema/entity-projection.js';

const TMP = join(dirname(fileURLToPath(import.meta.url)), '__tmp_graph_nav_sync');
const DB_PATH = join(TMP, 'data');

let server: TrellisHttpServer;
let baseUrl: string;

beforeAll(async () => {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
  const config = defaultLocalConfig(DB_PATH);
  const pool = new TenantPool(DB_PATH, {
    backend: { backend: 'sqljs' },
  });
  await pool.preload();
  server = await startServer({ port: 0, config, pool });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  if (server) {
    await Promise.race([
      Promise.resolve(server.stop(true)),
      delay(1500),
    ]);
  }
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitFor<T>(
  fn: () => T | undefined | null | false,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const v = fn();
      if (v) {
        resolve(v as T);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitFor timeout'));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

describe('graph-nav live sync (two clients)', () => {
  it('pushes subscription updates when another client mutates', async () => {
    const clientA = new TrellisDb({ url: baseUrl });
    const clientB = new TrellisDb({ url: baseUrl });

    const eql = 'find ?e where type = "NavSection"';
    let latest: Array<Record<string, unknown>> = [];

    const sub = clientA.subscribe<Record<string, unknown>>(eql, (rows) => {
      latest = rows;
    });

    await delay(150);

    const id = await clientB.create('NavSection', {
      label: 'Sync Probe',
      order: 99,
      collapsed: false,
    });

    await waitFor(() =>
      latest.some((r) => bindingEntityId(r) === id),
    );

    const row = latest.find((r) => bindingEntityId(r) === id);
    expect(row).toMatchObject({
      id,
      type: 'NavSection',
      label: 'Sync Probe',
    });

    sub.unsubscribe();
    clientA.disconnect();
    clientB.disconnect();
  });

  it('hydrated liveEntities sees cross-client creates', async () => {
    const { liveEntities } = await import('../../src/client/live.js');

    const clientA = new TrellisDb({ url: baseUrl });
    const clientB = new TrellisDb({ url: baseUrl });

    const res = liveEntities(clientA, 'NavItem');
    const seen: Array<{ count: number }> = [];
    const off = res.signal.subscribe((s) => {
      if (!s.loading) seen.push({ count: s.data.length });
    });
    const stop = res.start();

    await delay(150);

    const sectionId = await clientB.create('NavSection', {
      label: 'Parent',
      order: 0,
      collapsed: false,
    });
    await clientB.create('NavItem', {
      label: 'Cross-tab item',
      order: 0,
      section: sectionId,
      href: '#/x',
    });

    await waitFor(() => {
      const last = seen.at(-1);
      return last && last.count >= 1;
    });

    const state = res.signal.peek();
    expect(state.data.some((e) => e.label === 'Cross-tab item')).toBe(true);

    off();
    stop();
    clientA.disconnect();
    clientB.disconnect();
  });
});

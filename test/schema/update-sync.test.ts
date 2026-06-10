/**
 * Cross-client live sync — attribute UPDATE propagation (the todo "toggle" contract).
 *
 * Companion to graph-nav-sync.test.ts, which covers cross-client *creates*. This
 * guards the case that regressed in the wild: a 3.1.x server pushed subscription
 * diffs on create but not on attribute update, so a todo checkbox toggled in one
 * tab never reached another. Two clients share one in-process server; client B
 * toggles an attribute, and client A's live read must observe the new value —
 * both at the signal level and through the Svelte `entitiesStore` subscriber the
 * templates actually consume.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { TrellisDb } from '../../src/client/sdk.js';
import { startServer } from '../../src/server/server.js';
import { TenantPool } from '../../src/server/tenancy.js';
import { defaultLocalConfig } from '../../src/client/config.js';
import type { TrellisHttpServer } from '../../src/server/server-shared.js';
import { liveEntities } from '../../src/client/live.js';
import { entitiesStore } from '../../src/svelte/schema-hooks.js';
import { defineType } from '../../src/schema/define.js';

const TMP = join(dirname(fileURLToPath(import.meta.url)), '__tmp_update_sync');
const DB_PATH = join(TMP, 'data');
const Task = defineType('Task', { title: z.string(), done: z.boolean() }, { title: 'title' });

let server: TrellisHttpServer;
let baseUrl: string;

beforeAll(async () => {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
  const config = defaultLocalConfig(DB_PATH);
  const pool = new TenantPool(DB_PATH); // default backend — matches `trellis db serve`
  await pool.preload();
  server = await startServer({ port: 0, config, pool });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  if (server) await Promise.race([Promise.resolve(server.stop(true)), delay(1500)]);
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const v = fn();
      if (v) return resolve(v as T);
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 40);
    };
    tick();
  });
}

describe('cross-client update sync', () => {
  it('liveEntities sees an attribute update made by another client', async () => {
    const clientA = new TrellisDb({ url: baseUrl });
    const clientB = new TrellisDb({ url: baseUrl });

    const res = liveEntities(clientA, 'Task');
    const off = res.signal.subscribe(() => {});
    const stop = res.start();
    await delay(150);

    const id = await clientB.create('Task', { title: 'toggle me', done: false });
    await waitFor(() => res.signal.peek().data.some((e) => e.id === id));
    await clientB.update(id, { done: true });
    await waitFor(() => res.signal.peek().data.find((e) => e.id === id)?.done === true);

    expect(res.signal.peek().data.find((e) => e.id === id)?.done).toBe(true);

    off();
    stop();
    clientA.disconnect();
    clientB.disconnect();
  });

  it('Svelte entitiesStore subscriber delivers the updated value (template read path)', async () => {
    const clientA = new TrellisDb({ url: baseUrl });
    const clientB = new TrellisDb({ url: baseUrl });
    await clientA.registerType(Task);

    const store = entitiesStore(clientA, Task);
    let latest: Array<{ id: string; done: boolean }> = [];
    const unsub = store.subscribe((s: { data: Array<{ id: string; done: boolean }> }) => {
      latest = s.data;
    });
    await delay(150);

    const id = await clientB.create('Task', { title: 'store toggle', done: false });
    await waitFor(() => latest.some((e) => e.id === id && e.done === false));
    await clientB.update(id, { done: true });
    await waitFor(() => latest.some((e) => e.id === id && e.done === true));

    expect(latest.find((e) => e.id === id)?.done).toBe(true);

    unsub();
    clientA.disconnect();
    clientB.disconnect();
  });
});

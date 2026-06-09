/**
 * TRL-5 — idempotent registerType (no surfaced 409 on re-register).
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
import { defineType } from '../../src/schema/define.js';
import type { TrellisHttpServer } from '../../src/server/server-shared.js';

const Note = defineType('Note', { title: z.string() });

const TMP = join(dirname(fileURLToPath(import.meta.url)), '__tmp_register_type');
const DB_PATH = join(TMP, 'data');

let server: TrellisHttpServer;
let baseUrl: string;

beforeAll(async () => {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
  const config = defaultLocalConfig(DB_PATH);
  const pool = new TenantPool(DB_PATH, { backend: { backend: 'sqljs' } });
  await pool.preload();
  server = await startServer({ port: 0, config, pool });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  if (server) await Promise.resolve(server.stop(true));
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

describe('registerType idempotent', () => {
  it('second register resolves without throw (TRL-5)', async () => {
    const client = new TrellisDb({ url: baseUrl });
    await client.registerType(Note);
    await expect(client.registerType(Note)).resolves.toBeUndefined();
    client.disconnect();
  });
});

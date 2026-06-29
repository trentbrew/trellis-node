/**
 * Room MCP — Playground CollectionRecord helper tool.
 */
import { mkdirSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { defaultLocalConfig } from '../../src/client/config.js';
import {
  collectionMetaIdFromSlug,
  resolveCollectionId,
} from '../../src/mcp/room-helpers.js';
import { startServer } from '../../src/server/server.js';
import type { TrellisHttpServer } from '../../src/server/server-shared.js';
import { TenantPool } from '../../src/server/tenancy.js';

const TMP = join(dirname(fileURLToPath(import.meta.url)), '__tmp_mcp_collection');
const DB_PATH = join(TMP, 'data');

let server: TrellisHttpServer;
let mcpUrl: string;

beforeAll(async () => {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
  const config = defaultLocalConfig(DB_PATH);
  const pool = new TenantPool(DB_PATH, { backend: { backend: 'sqljs' } });
  await pool.preload();
  server = await startServer({ port: 0, config, pool });
  mcpUrl = `http://127.0.0.1:${server.port}/mcp`;
});

afterAll(async () => {
  if (server) {
    await Promise.race([
      Promise.resolve(server.stop(true)),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  }
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

describe('collection id helpers', () => {
  it('builds stable collectionMeta ids', () => {
    expect(collectionMetaIdFromSlug('people')).toBe('collectionMeta:people');
    expect(collectionMetaIdFromSlug('collectionMeta:ideas')).toBe(
      'collectionMeta:ideas',
    );
  });

  it('resolves collection id from slug or explicit id', () => {
    expect(
      resolveCollectionId({ collectionSlug: 'ship-log' }),
    ).toBe('collectionMeta:ship-log');
    expect(
      resolveCollectionId({ collectionId: 'collectionMeta:custom' }),
    ).toBe('collectionMeta:custom');
  });
});

describe('create_collection_record', () => {
  it('creates record with stable collectionId and optional meta', async () => {
    const client = new Client({ name: 'collection-record-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
    await client.connect(transport);
    try {
      const created = await client.callTool({
        name: 'create_collection_record',
        arguments: {
          collectionSlug: 'mcp-people',
          title: 'MCP Agent',
          body: 'Created via create_collection_record',
          ensureCollection: true,
          collectionTitle: 'People',
          room: 'collection-record-test',
          lane: 'agent:mcp-test',
        },
      });
      const data = JSON.parse(
        (created.content as { text: string }[])[0].text,
      );
      expect(data.collectionId).toBe('collectionMeta:mcp-people');
      expect(data.collectionCreated).toBe(true);
      expect(data.tenantId).toBe('embed-collection-record-test');

      const record = await client.callTool({
        name: 'get_node',
        arguments: { id: data.id, room: 'collection-record-test' },
      });
      const recordData = JSON.parse(
        (record.content as { text: string }[])[0].text,
      );
      expect(recordData.type).toBe('CollectionRecord');
      expect(recordData.collectionId).toBe('collectionMeta:mcp-people');
      expect(recordData.title).toBe('MCP Agent');

      const query = await client.callTool({
        name: 'query_graph',
        arguments: {
          query: 'find ?e where type = "CollectionRecord"',
          room: 'collection-record-test',
        },
      });
      const bindings = JSON.parse(
        (query.content as { text: string }[])[0].text,
      ).bindings;
      expect(bindings.length).toBeGreaterThanOrEqual(1);

      const meta = await client.callTool({
        name: 'get_node',
        arguments: {
          id: 'collectionMeta:mcp-people',
          room: 'collection-record-test',
        },
      });
      const metaData = JSON.parse((meta.content as { text: string }[])[0].text);
      expect(metaData.type).toBe('CollectionMeta');
      expect(metaData.slug).toBe('mcp-people');
    } finally {
      await transport.close();
    }
  });
});

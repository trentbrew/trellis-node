/**
 * Room MCP write audit — Decision entities in graph.
 */
import { mkdirSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { defaultLocalConfig } from '../../src/client/config.js';
import { startServer } from '../../src/server/server.js';
import type { TrellisHttpServer } from '../../src/server/server-shared.js';
import { TenantPool } from '../../src/server/tenancy.js';

const TMP = join(dirname(fileURLToPath(import.meta.url)), '__tmp_mcp_audit');
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

describe('room MCP audit', () => {
  it('create_node emits a Decision entity', async () => {
    const client = new Client({ name: 'audit-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
    await client.connect(transport);
    try {
      await client.callTool({
        name: 'create_node',
        arguments: {
          type: 'Note',
          id: 'note:audit-target',
          attributes: { title: 'Audited' },
          lane: 'agent:audit-test',
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      const summary = await client.callTool({
        name: 'get_graph_summary',
        arguments: { limit: 20 },
      });
      const text = (summary.content as { type: string; text: string }[])[0]
        ?.text;
      const data = JSON.parse(text!);
      const hasDecision = data.entityTypes.some(
        (t: { type: string }) => t.type === 'Decision',
      );
      expect(hasDecision).toBe(true);
    } finally {
      await transport.close();
    }
  });
});

/**
 * Room MCP gateway — Streamable HTTP on trellis db serve.
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

const TMP = join(dirname(fileURLToPath(import.meta.url)), '__tmp_mcp_gateway');
const DB_PATH = join(TMP, 'data');

let server: TrellisHttpServer;
let mcpUrl: string;

beforeAll(async () => {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
  const config = defaultLocalConfig(DB_PATH);
  const pool = new TenantPool(DB_PATH, {
    backend: { backend: 'sqljs' },
  });
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

async function withMcpClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ name: 'trellis-mcp-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await transport.close();
  }
}

describe('Room MCP gateway', () => {
  it('lists graph tools', async () => {
    await withMcpClient(async (client) => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('graph_health');
      expect(names).toContain('get_graph_summary');
      expect(names).toContain('link_nodes');
      expect(names).toContain('query_graph');
      expect(names).toContain('create_node');
    });
  });

  it('graph_health returns ok', async () => {
    await withMcpClient(async (client) => {
      const result = await client.callTool({
        name: 'graph_health',
        arguments: {},
      });
      const text = (result.content as { type: string; text: string }[])[0]
        ?.text;
      expect(text).toBeTruthy();
      const data = JSON.parse(text!);
      expect(data.status).toBe('ok');
    });
  });

  it('get_graph_summary returns health block', async () => {
    await withMcpClient(async (client) => {
      const result = await client.callTool({
        name: 'get_graph_summary',
        arguments: { limit: 5 },
      });
      const text = (result.content as { type: string; text: string }[])[0]
        ?.text;
      const data = JSON.parse(text!);
      expect(data.health.status).toBe('ok');
      expect(data.entityTypes).toBeDefined();
    });
  });

  it('link_nodes connects two entities', async () => {
    await withMcpClient(async (client) => {
      await client.callTool({
        name: 'create_node',
        arguments: {
          type: 'Note',
          id: 'note:link-a',
          attributes: { title: 'A' },
        },
      });
      await client.callTool({
        name: 'create_node',
        arguments: {
          type: 'Task',
          id: 'task:link-b',
          attributes: { title: 'B' },
        },
      });
      const linked = await client.callTool({
        name: 'link_nodes',
        arguments: {
          e1: 'task:link-b',
          relation: 'assignedTo',
          e2: 'note:link-a',
          lane: 'agent:mcp-test',
        },
      });
      const linkedText = (
        linked.content as { type: string; text: string }[]
      )[0]?.text;
      expect(JSON.parse(linkedText!).lane).toBe('agent:mcp-test');
    });
  });

  it('create_node + get_node round-trip', async () => {
    await withMcpClient(async (client) => {
      const created = await client.callTool({
        name: 'create_node',
        arguments: {
          type: 'Note',
          id: 'note:mcp-test-1',
          attributes: { title: 'MCP spike', body: 'hello' },
        },
      });
      const createdText = (
        created.content as { type: string; text: string }[]
      )[0]?.text;
      expect(JSON.parse(createdText!).id).toBe('note:mcp-test-1');

      const read = await client.callTool({
        name: 'get_node',
        arguments: { id: 'note:mcp-test-1' },
      });
      const readText = (read.content as { type: string; text: string }[])[0]
        ?.text;
      const entity = JSON.parse(readText!);
      expect(entity.title).toBe('MCP spike');
    });
  });
});

/**
 * Room MCP — playground tenant targeting (embed-{slug}).
 */
import { mkdirSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { defaultLocalConfig } from '../../src/client/config.js';
import {
  playgroundRoomToTenant,
  resolveMcpTenantId,
} from '../../src/mcp/room-helpers.js';
import { startServer } from '../../src/server/server.js';
import type { TrellisHttpServer } from '../../src/server/server-shared.js';
import { TenantPool } from '../../src/server/tenancy.js';

const TMP = join(dirname(fileURLToPath(import.meta.url)), '__tmp_mcp_tenant');
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

describe('tenant helpers', () => {
  it('maps playground room slug to embed tenant', () => {
    expect(playgroundRoomToTenant('design-review')).toBe(
      'embed-design-review',
    );
    expect(playgroundRoomToTenant('embed-lobby')).toBe('embed-lobby');
  });

  it('resolves tool room over header and default', () => {
    expect(
      resolveMcpTenantId({
        defaultTenantId: null,
        headerTenant: 'embed-header',
        roomSlug: 'my-room',
      }),
    ).toBe('embed-my-room');
    expect(
      resolveMcpTenantId({
        defaultTenantId: 'default',
        toolTenantId: 'embed-explicit',
      }),
    ).toBe('embed-explicit');
  });
});

describe('room MCP tenant tools', () => {
  it('isolates create_node by room slug', async () => {
    const client = new Client({ name: 'tenant-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
    await client.connect(transport);
    try {
      const defaultHealth = await client.callTool({
        name: 'graph_health',
        arguments: {},
      });
      const defaultCount = JSON.parse(
        (defaultHealth.content as { text: string }[])[0].text,
      ).entities;

      const created = await client.callTool({
        name: 'create_node',
        arguments: {
          type: 'Note',
          id: 'note:tenant-isolation-test',
          attributes: { title: 'tenant slice' },
          room: 'agent-crud-test',
          lane: 'agent:mcp-test',
        },
      });
      const createdData = JSON.parse(
        (created.content as { text: string }[])[0].text,
      );
      expect(createdData.tenantId).toBe('embed-agent-crud-test');

      const tenantHealth = await client.callTool({
        name: 'graph_health',
        arguments: { room: 'agent-crud-test' },
      });
      const tenantCount = JSON.parse(
        (tenantHealth.content as { text: string }[])[0].text,
      ).entities;
      expect(tenantCount).toBeGreaterThanOrEqual(1);

      const defaultAfter = await client.callTool({
        name: 'graph_health',
        arguments: {},
      });
      const defaultAfterCount = JSON.parse(
        (defaultAfter.content as { text: string }[])[0].text,
      ).entities;
      expect(defaultAfterCount).toBe(defaultCount);

      await client.callTool({
        name: 'delete_node',
        arguments: { id: 'note:tenant-isolation-test', room: 'agent-crud-test' },
      });
    } finally {
      await transport.close();
    }
  });

  it('honors X-Trellis-Tenant header on MCP session', async () => {
    const tenant = 'embed-header-session';
    const client = new Client({ name: 'header-tenant-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: { headers: { 'X-Trellis-Tenant': tenant } },
    });
    await client.connect(transport);
    try {
      const health = await client.callTool({
        name: 'graph_health',
        arguments: {},
      });
      const data = JSON.parse((health.content as { text: string }[])[0].text);
      expect(data.tenantId).toBe(tenant);
    } finally {
      await transport.close();
    }
  });
});

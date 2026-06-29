/**
 * Room MCP stdio bridge — resolves config and proxies tools to remote room.
 */
import { mkdirSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { defaultLocalConfig, writeConfig } from '../../src/client/config.js';
import {
  connectRemoteRoomClient,
  createRoomMcpProxyServer,
  resolveBridgeConfig,
  resolveRoomMcpUrl,
} from '../../src/mcp/bridge.js';
import { startServer } from '../../src/server/server.js';
import type { TrellisHttpServer } from '../../src/server/server-shared.js';
import { TenantPool } from '../../src/server/tenancy.js';

const TMP = join(dirname(fileURLToPath(import.meta.url)), '__tmp_mcp_bridge');
const DB_PATH = join(TMP, 'data');
const CONFIG_DIR = join(TMP, 'project');

let server: TrellisHttpServer;
let roomBaseUrl: string;

beforeAll(async () => {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });

  const pool = new TenantPool(DB_PATH, { backend: { backend: 'sqljs' } });
  await pool.preload();
  const config = defaultLocalConfig(DB_PATH, {
    port: 0,
    apiKey: 'spk_test_bridge',
  });
  server = await startServer({ port: 0, config, pool });
  roomBaseUrl = `http://127.0.0.1:${server.port}`;
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeConfig(
    { ...config, port: server.port, url: roomBaseUrl, mode: 'remote' },
    CONFIG_DIR,
  );
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

describe('resolveRoomMcpUrl', () => {
  it('uses /trellis/mcp on Sprites hosts', () => {
    expect(resolveRoomMcpUrl('https://room.sprites.app')).toBe(
      'https://room.sprites.app/trellis/mcp',
    );
  });

  it('appends /mcp to local base URL', () => {
    expect(resolveRoomMcpUrl('http://127.0.0.1:8230')).toBe(
      'http://127.0.0.1:8230/mcp',
    );
  });

  it('preserves existing /mcp suffix', () => {
    expect(resolveRoomMcpUrl('https://room.sprites.app/mcp')).toBe(
      'https://room.sprites.app/mcp',
    );
  });
});

describe('resolveBridgeConfig', () => {
  it('reads room URL and API key from .trellis-db.json', () => {
    const resolved = resolveBridgeConfig({ configDir: CONFIG_DIR });
    expect(resolved.url).toBe(`${roomBaseUrl}/mcp`);
    expect(resolved.apiKey).toBe('spk_test_bridge');
  });

  it('CLI room flag overrides config file', () => {
    const resolved = resolveBridgeConfig({
      configDir: CONFIG_DIR,
      room: 'https://override.example.com',
      apiKey: 'spk_override',
    });
    expect(resolved.url).toBe('https://override.example.com/mcp');
    expect(resolved.apiKey).toBe('spk_override');
  });

  it('reads TRELLIS_ROOM_URL when config file lacks url', () => {
    const prev = process.env.TRELLIS_ROOM_URL;
    process.env.TRELLIS_ROOM_URL = 'https://env-room.example.com';
    try {
      const resolved = resolveBridgeConfig({});
      expect(resolved.url).toBe('https://env-room.example.com/mcp');
    } finally {
      if (prev === undefined) delete process.env.TRELLIS_ROOM_URL;
      else process.env.TRELLIS_ROOM_URL = prev;
    }
  });
});

describe('Room MCP proxy server', () => {
  it('forwards listTools and callTool to remote room', async () => {
    const mcpUrl = resolveRoomMcpUrl(roomBaseUrl);
    const { client: remote, transport: remoteTransport } =
      await connectRemoteRoomClient({
        url: mcpUrl,
        apiKey: 'spk_test_bridge',
      });

    const proxy = createRoomMcpProxyServer(remote);
    const local = new Client({ name: 'bridge-test', version: '1.0.0' });
    const { InMemoryTransport } = await import(
      '@modelcontextprotocol/sdk/inMemory.js'
    );
    const [localTransport, proxyTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      local.connect(localTransport),
      proxy.connect(proxyTransport),
    ]);

    try {
      const { tools } = await local.listTools();
      expect(tools.map((t) => t.name)).toContain('graph_health');

      const result = await local.callTool({
        name: 'graph_health',
        arguments: {},
      });
      const text = (result.content as { type: string; text: string }[])[0]
        ?.text;
      expect(JSON.parse(text!).status).toBe('ok');
    } finally {
      await remoteTransport.close();
    }
  });
});

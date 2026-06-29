/**
 * Room registry + discovery MCP gateway tests.
 */
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { writeConfig } from '../../src/client/config.js';
import {
  getRegisteredRoom,
  listRegisteredRooms,
} from '../../src/mcp/room-registry.js';
import { startGatewayServer } from '../../src/mcp/gateway-serve.js';

const TMP = join(dirname(fileURLToPath(import.meta.url)), '__tmp_discovery');
const CONFIG_DIR = join(TMP, 'project');

describe('room registry', () => {
  beforeAll(() => {
    if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    writeConfig(
      {
        mode: 'remote',
        url: 'https://playground-room.sprites.app',
        apiKey: 'spk_registry_test',
        spriteName: 'playground-room',
        deployedAt: '2026-06-15T00:00:00.000Z',
      },
      CONFIG_DIR,
    );
    writeFileSync(
      join(CONFIG_DIR, '.trellis-rooms.json'),
      JSON.stringify([
        {
          name: 'extra-room',
          url: 'https://extra.sprites.app',
          apiKey: 'spk_extra',
        },
      ]),
      'utf8',
    );
  });

  afterAll(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  });

  it('lists project and registry rooms', () => {
    const rooms = listRegisteredRooms({ configDir: CONFIG_DIR });
    expect(rooms.some((r) => r.name === 'playground-room')).toBe(true);
    expect(rooms.some((r) => r.name === 'extra-room')).toBe(true);
  });

  it('gets room by name', () => {
    const room = getRegisteredRoom('playground-room', { configDir: CONFIG_DIR });
    expect(room?.mcpUrl).toBe(
      'https://playground-room.sprites.app/trellis/mcp',
    );
  });
});

describe('discovery MCP gateway', () => {
  let gatewayUrl: string;
  let stop: () => void;

  beforeAll(async () => {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    writeConfig(
      {
        mode: 'remote',
        url: 'https://demo.sprites.app',
        apiKey: 'spk_demo',
        spriteName: 'demo',
      },
      CONFIG_DIR,
    );
    const server = await startGatewayServer({
      port: 0,
      configDir: CONFIG_DIR,
    });
    gatewayUrl = `http://127.0.0.1:${server.port}/mcp`;
    stop = server.stop;
  });

  afterAll(() => {
    stop?.();
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  });

  it('list_rooms via Streamable HTTP', async () => {
    const client = new Client({ name: 'discovery-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(gatewayUrl));
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('list_rooms');
      expect(tools.map((t) => t.name)).toContain('connect_room');

      const result = await client.callTool({
        name: 'list_rooms',
        arguments: {},
      });
      const text = (result.content as { type: string; text: string }[])[0]
        ?.text;
      const data = JSON.parse(text!);
      expect(data.count).toBeGreaterThan(0);
    } finally {
      await transport.close();
    }
  });
});

describe('oauth metadata', () => {
  it('protected resource document shape', async () => {
    const { oauthProtectedResourceMetadata } = await import(
      '../../src/server/mcp-oauth-metadata.js'
    );
    const doc = oauthProtectedResourceMetadata('https://room.sprites.app');
    expect(doc.resource).toBe('https://room.sprites.app/mcp');
    expect(doc.authorization_servers).toContain('https://room.sprites.app');
  });
});

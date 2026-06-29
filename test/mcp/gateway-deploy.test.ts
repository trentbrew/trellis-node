/**
 * MCP gateway deploy — stub mode.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deployMcpGateway } from '../../src/server/deploy-gateway.js';
import { GATEWAY_CONFIG_FILE } from '../../src/mcp/gateway-config.js';

describe('deployMcpGateway stub', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'trellis-gateway-deploy-'));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('writes .trellis-mcp-gateway.json and .trellis-rooms.json', async () => {
    const result = await deployMcpGateway({
      name: 'mcp-gateway',
      publicUrl: 'https://mcp.trellis.computer',
      stub: true,
      configDir,
    });

    expect(result.publicUrl).toBe('https://mcp.trellis.computer');
    expect(result.name).toBe('mcp-gateway');

    const config = JSON.parse(
      readFileSync(join(configDir, GATEWAY_CONFIG_FILE), 'utf8'),
    ) as Record<string, unknown>;
    expect(config.publicUrl).toBe('https://mcp.trellis.computer');
    expect(config.spriteName).toBe('mcp-gateway');

    expect(existsSync(join(configDir, '.trellis-rooms.json'))).toBe(true);
  });
});

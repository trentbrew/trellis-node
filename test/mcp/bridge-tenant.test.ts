/**
 * Room MCP bridge — playground tenant resolution.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeConfig } from '../../src/client/config.js';
import { resolveBridgeConfig } from '../../src/mcp/bridge.js';

const TMP = join(dirname(fileURLToPath(import.meta.url)), '__tmp_bridge_tenant');
const CONFIG_DIR = join(TMP, 'project');

describe('resolveBridgeConfig tenant', () => {
  beforeEach(() => {
    if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    writeConfig(
      {
        mode: 'remote',
        url: 'https://room.sprites.app',
        apiKey: 'spk_test',
      },
      CONFIG_DIR,
    );
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
    delete process.env.TRELLIS_TENANT_ID;
    delete process.env.TRELLIS_PLAYGROUND_ROOM;
  });

  it('appends tenantId query and resolves playground room slug', () => {
    const resolved = resolveBridgeConfig({
      configDir: CONFIG_DIR,
      playgroundRoom: 'design-review',
    });
    expect(resolved.tenantId).toBe('embed-design-review');
    expect(resolved.url).toContain('tenantId=embed-design-review');
    expect(resolved.url).toContain('/trellis/mcp');
  });

  it('prefers explicit --tenant over playground room', () => {
    const resolved = resolveBridgeConfig({
      configDir: CONFIG_DIR,
      tenant: 'embed-custom',
      playgroundRoom: 'other',
    });
    expect(resolved.tenantId).toBe('embed-custom');
  });
});

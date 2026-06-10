import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deploy } from '../../src/server/deploy.js';
import { CONFIG_FILE } from '../../src/client/config.js';

describe('deploy stub mode', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'trellis-deploy-'));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('writes remote .trellis-db.json without calling Sprites', async () => {
    const result = await deploy({
      name: 'My-Stub-Room',
      stub: true,
      configDir,
      apiKey: 'spk_test_stub',
    });

    expect(result.url).toBe('https://my-stub-room.sprites.app');
    expect(result.name).toBe('my-stub-room');
    expect(result.apiKey).toBe('spk_test_stub');

    const config = JSON.parse(
      readFileSync(join(configDir, CONFIG_FILE), 'utf8'),
    ) as Record<string, unknown>;

    expect(config.mode).toBe('remote');
    expect(config.url).toBe(result.url);
    expect(config.apiKey).toBe('spk_test_stub');
    expect(config.spriteName).toBe('my-stub-room');
    expect(typeof config.deployedAt).toBe('string');
  });

  it('rejects invalid names before writing config', async () => {
    await expect(
      deploy({ name: '!!', stub: true, configDir }),
    ).rejects.toThrow(/Deploy name/);
  });
});

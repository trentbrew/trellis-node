import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  readConfig,
  writeConfig,
  updateConfig,
  hasConfig,
  defaultLocalConfig,
  CONFIG_FILE,
} from '../../src/client/config.js';

const TMP = join(import.meta.dir, '__tmp_config_test');

beforeEach(() => {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

describe('config', () => {
  it('returns null when no config file exists', () => {
    expect(readConfig(TMP)).toBeNull();
  });

  it('hasConfig returns false when missing', () => {
    expect(hasConfig(TMP)).toBe(false);
  });

  it('writes and reads back a config', () => {
    const cfg = defaultLocalConfig('/data/mydb', { port: 4000 });
    writeConfig(cfg, TMP);

    expect(hasConfig(TMP)).toBe(true);
    const read = readConfig(TMP);
    expect(read).not.toBeNull();
    expect(read!.mode).toBe('local');
    expect(read!.dbPath).toBe('/data/mydb');
    expect(read!.port).toBe(4000);
  });

  it('updateConfig merges partial updates', () => {
    writeConfig({ mode: 'local', dbPath: '/data/db', port: 3000 }, TMP);
    const merged = updateConfig({ port: 9000, apiKey: 'spk_abc' }, TMP);
    expect(merged.port).toBe(9000);
    expect(merged.apiKey).toBe('spk_abc');
    expect(merged.dbPath).toBe('/data/db');
  });

  it('config file is named .trellis-db.json', () => {
    expect(CONFIG_FILE).toBe('.trellis-db.json');
  });
});

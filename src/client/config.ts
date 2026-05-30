/**
 * Trellis Client — Configuration
 *
 * Manages `.trellis-db.json` — the local project config file that records
 * whether this instance is running locally or deployed to Sprites.
 *
 * @module trellis/client
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DbMode = 'local' | 'remote';

export interface TrellisDbConfig {
  /** Whether the DB is local (SQLite) or remote (Sprites/custom URL). */
  mode: DbMode;
  /** Absolute path to the SQLite database directory (local mode). */
  dbPath?: string;
  /** Remote API base URL (remote mode). */
  url?: string;
  /** API key for remote mode authentication. */
  apiKey?: string;
  /** Sprites sprite name (used for deploy). */
  spriteName?: string;
  /** ISO timestamp of last deploy. */
  deployedAt?: string;
  /** Port for local server mode (default: 3000). */
  port?: number;
  /** Enable multi-tenancy (separate SQLite per tenant). */
  multiTenant?: boolean;
  /** Secret used to sign/verify JWTs. */
  jwtSecret?: string;
}

// ---------------------------------------------------------------------------
// Default config file name
// ---------------------------------------------------------------------------

export const CONFIG_FILE = '.trellis-db.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the config file path relative to a directory.
 */
export function configPath(dir = '.'): string {
  return resolve(join(dir, CONFIG_FILE));
}

/**
 * Check if a `.trellis-db.json` exists in the given directory.
 */
export function hasConfig(dir = '.'): boolean {
  return existsSync(configPath(dir));
}

/**
 * Read and parse the `.trellis-db.json` config file.
 * Returns null if the file doesn't exist.
 */
export function readConfig(dir = '.'): TrellisDbConfig | null {
  const path = configPath(dir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as TrellisDbConfig;
  } catch {
    throw new Error(`Failed to parse ${path}: invalid JSON`);
  }
}

/**
 * Write a config to `.trellis-db.json`.
 */
export function writeConfig(config: TrellisDbConfig, dir = '.'): void {
  const path = configPath(dir);
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/**
 * Merge partial updates into an existing config file (creates if missing).
 */
export function updateConfig(
  updates: Partial<TrellisDbConfig>,
  dir = '.',
): TrellisDbConfig {
  const existing = readConfig(dir) ?? { mode: 'local' };
  const merged = { ...existing, ...updates };
  writeConfig(merged, dir);
  return merged;
}

/**
 * Build a local config with sensible defaults for a given directory.
 */
export function defaultLocalConfig(
  dbPath: string,
  opts: Partial<TrellisDbConfig> = {},
): TrellisDbConfig {
  return {
    mode: 'local',
    dbPath,
    port: 3000,
    multiTenant: false,
    ...opts,
  };
}

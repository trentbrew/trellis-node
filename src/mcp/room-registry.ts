/**
 * Room registry — known Trellis rooms for MCP discovery.
 *
 * Aggregates deploy metadata from ~/.trellis/vm.json, project .trellis-db.json,
 * and optional TRELLIS_ROOM_REGISTRY / TRELLIS_MCP_GATEWAY_ROOMS env JSON.
 *
 * @module trellis/mcp
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { readConfig } from '../client/config.js';
import { readGatewayConfig } from './gateway-config.js';
import { loadVmConfig } from '../server/vm-config.js';

export interface RegisteredRoom {
  name: string;
  url: string;
  mcpUrl: string;
  apiKey?: string;
  source: 'vm' | 'project' | 'registry' | 'env';
  deployedAt?: string;
  active?: boolean;
}

export interface RoomRegistryOptions {
  /** Project directory for .trellis-db.json (default: cwd). */
  configDir?: string;
  /** Public gateway base URL for connect_room hints (e.g. https://mcp.trellis.computer). */
  gatewayPublicUrl?: string;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

/** MCP HTTP path for a room host (Sprites reserves `/mcp` on *.sprites.app). */
export function roomMcpPathForUrl(baseUrl: string): string {
  const env = process.env.TRELLIS_MCP_PATH?.trim();
  if (env) return env.startsWith('/') ? env : `/${env}`;
  try {
    const host = new URL(baseUrl).hostname;
    if (/\.sprites\.app$/i.test(host)) return '/trellis/mcp';
  } catch {
    /* ignore */
  }
  return '/mcp';
}

function toMcpUrl(base: string): string {
  const trimmed = normalizeBaseUrl(base);
  if (trimmed.endsWith('/mcp') || trimmed.endsWith('/trellis/mcp')) {
    return trimmed;
  }
  return `${trimmed}${roomMcpPathForUrl(trimmed)}`;
}

function parseRegistryJson(raw: string, source: 'registry' | 'env'): RegisteredRoom[] {
  try {
    const data = JSON.parse(raw) as
      | RegisteredRoom[]
      | { rooms?: RegisteredRoom[] };
    const rooms = Array.isArray(data) ? data : (data.rooms ?? []);
    return rooms
      .filter((r) => r.name && r.url)
      .map((r) => ({
        name: r.name,
        url: normalizeBaseUrl(r.url),
        mcpUrl: toMcpUrl(normalizeBaseUrl(r.url)),
        apiKey: r.apiKey,
        source,
        deployedAt: r.deployedAt,
        active: r.active,
      }));
  } catch {
    return [];
  }
}

/**
 * List all known rooms, de-duplicated by URL (vm.json wins over project config).
 */
export function listRegisteredRooms(opts: RoomRegistryOptions = {}): RegisteredRoom[] {
  const configDir = opts.configDir ?? '.';
  const byUrl = new Map<string, RegisteredRoom>();

  const envRooms = process.env.TRELLIS_MCP_GATEWAY_ROOMS?.trim();
  if (envRooms) {
    for (const room of parseRegistryJson(envRooms, 'env')) {
      byUrl.set(room.url, room);
    }
  }

  const registryPath =
    process.env.TRELLIS_ROOM_REGISTRY?.trim() ??
    resolve(configDir, '.trellis-rooms.json');
  if (existsSync(registryPath)) {
    try {
      const raw = readFileSync(registryPath, 'utf8');
      for (const room of parseRegistryJson(raw, 'registry')) {
        byUrl.set(room.url, room);
      }
    } catch {
      /* ignore */
    }
  }

  const vm = loadVmConfig();
  for (const [name, sprite] of Object.entries(vm.sprites)) {
    if (!sprite.hasTrellis && !sprite.apiKey) continue;
    const url = normalizeBaseUrl(sprite.url);
    byUrl.set(url, {
      name,
      url,
      mcpUrl: toMcpUrl(url),
      apiKey: sprite.apiKey,
      source: 'vm',
      active: vm.activeSprite === name,
    });
  }

  const dbConfig = readConfig(configDir);
  if (dbConfig?.mode === 'remote' && dbConfig.url) {
    const url = normalizeBaseUrl(dbConfig.url);
    const name = dbConfig.spriteName ?? url.replace(/^https?:\/\//, '').split('.')[0]!;
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        name,
        url,
        mcpUrl: toMcpUrl(url),
        apiKey: dbConfig.apiKey,
        source: 'project',
        deployedAt: dbConfig.deployedAt,
        active: true,
      });
    }
  }

  return [...byUrl.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getRegisteredRoom(
  nameOrUrl: string,
  opts?: RoomRegistryOptions,
): RegisteredRoom | null {
  const needle = nameOrUrl.trim().toLowerCase();
  const rooms = listRegisteredRooms(opts);
  return (
    rooms.find(
      (r) =>
        r.name.toLowerCase() === needle ||
        r.url.toLowerCase() === needle ||
        r.mcpUrl.toLowerCase() === needle ||
        normalizeBaseUrl(needle).endsWith(r.name.toLowerCase()),
    ) ?? null
  );
}

export function gatewayPublicUrl(opts?: RoomRegistryOptions): string {
  const fromConfig = readGatewayConfig(opts?.configDir ?? '.')?.publicUrl?.trim();
  if (fromConfig) return fromConfig.replace(/\/$/, '');
  if (opts?.gatewayPublicUrl?.trim()) {
    return opts.gatewayPublicUrl.trim().replace(/\/$/, '');
  }
  const env = process.env.TRELLIS_MCP_GATEWAY_PUBLIC_URL?.trim();
  if (env) return env.replace(/\/$/, '');
  return 'https://mcp.trellis.computer';
}

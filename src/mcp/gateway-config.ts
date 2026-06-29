/**
 * `.trellis-mcp-gateway.json` — local config for a deployed discovery gateway.
 *
 * @module trellis/mcp
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

export const GATEWAY_CONFIG_FILE = '.trellis-mcp-gateway.json';

export interface McpGatewayConfig {
  /** Sprites URL (API origin). */
  url: string;
  /** Public URL agents use (e.g. https://mcp.trellis.computer). */
  publicUrl: string;
  spriteName: string;
  deployedAt: string;
  port?: number;
}

export function gatewayConfigPath(dir = '.'): string {
  return resolve(join(dir, GATEWAY_CONFIG_FILE));
}

export function hasGatewayConfig(dir = '.'): boolean {
  return existsSync(gatewayConfigPath(dir));
}

export function readGatewayConfig(dir = '.'): McpGatewayConfig | null {
  const path = gatewayConfigPath(dir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as McpGatewayConfig;
  } catch {
    throw new Error(`Failed to parse ${path}: invalid JSON`);
  }
}

export function writeGatewayConfig(config: McpGatewayConfig, dir = '.'): void {
  writeFileSync(
    gatewayConfigPath(dir),
    JSON.stringify(config, null, 2) + '\n',
    'utf8',
  );
}

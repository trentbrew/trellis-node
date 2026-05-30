/**
 * Global VM Configuration
 *
 * Manages persistent VM configuration stored at ~/.trellis/vm.json.
 * Tracks active sprite and sprite metadata for the trellis vm commands.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * VM configuration interface.
 */
export interface VmConfig {
  activeSprite: string | null;
  sprites: Record<
    string,
    {
      name: string;
      createdAt: string;
      url: string;
      hasTrellis: boolean;
      apiKey?: string;
      lastCheckpoint?: string;
      linkedMilestone?: string;
    }
  >;
}

/**
 * Get the VM config directory path.
 */
function getVmDir(): string {
  return join(homedir(), '.trellis');
}

/**
 * Get the VM config file path.
 */
function getVmPath(): string {
  return join(getVmDir(), 'vm.json');
}

/**
 * Load the VM configuration, or return default if not yet created.
 */
export function loadVmConfig(): VmConfig {
  const vmPath = getVmPath();
  if (!existsSync(vmPath)) {
    return {
      activeSprite: null,
      sprites: {},
    };
  }
  try {
    const raw = readFileSync(vmPath, 'utf-8');
    return JSON.parse(raw) as VmConfig;
  } catch {
    // Return default if corrupted
    return {
      activeSprite: null,
      sprites: {},
    };
  }
}

/**
 * Save (or overwrite) the VM configuration.
 */
export function saveVmConfig(config: VmConfig): void {
  const dir = getVmDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getVmPath(), JSON.stringify(config, null, 2));
}

/**
 * Get the currently active sprite name.
 */
export function getActiveSprite(): string | null {
  const config = loadVmConfig();
  return config.activeSprite;
}

/**
 * Set the active sprite name.
 */
export function setActiveSprite(spriteName: string): void {
  const config = loadVmConfig();
  // Ensure the sprite exists in our tracking
  if (!config.sprites[spriteName]) {
    config.sprites[spriteName] = {
      name: spriteName,
      createdAt: new Date().toISOString(),
      url: `https://${spriteName}.sprites.app`,
      hasTrellis: false,
    };
  }
  config.activeSprite = spriteName;
  saveVmConfig(config);
}

/**
 * Track a sprite in the VM config (called after creation/deploy).
 */
export function trackSprite(
  spriteName: string,
  opts: {
    url?: string;
    hasTrellis?: boolean;
    apiKey?: string;
    lastCheckpoint?: string;
    linkedMilestone?: string;
  } = {},
): void {
  const config = loadVmConfig();
  const existing = config.sprites[spriteName] ?? {
    name: spriteName,
    createdAt: new Date().toISOString(),
    url: `https://${spriteName}.sprites.app`,
    hasTrellis: false,
  };

  config.sprites[spriteName] = {
    ...existing,
    ...opts,
    url: opts.url ?? existing.url,
    hasTrellis: opts.hasTrellis ?? existing.hasTrellis,
  };

  // If no active sprite is set, make this one active
  if (!config.activeSprite) {
    config.activeSprite = spriteName;
  }

  saveVmConfig(config);
}

/**
 * Untrack a sprite (called after destruction).
 */
export function untrackSprite(spriteName: string): void {
  const config = loadVmConfig();
  delete config.sprites[spriteName];

  // If we removed the active sprite, clear active selection
  if (config.activeSprite === spriteName) {
    config.activeSprite = null;
  }

  saveVmConfig(config);
}

/**
 * Check if a sprite is being tracked.
 */
export function isSpriteTracked(spriteName: string): boolean {
  const config = loadVmConfig();
  return !!config.sprites[spriteName];
}

/**
 * Get sprite metadata by name.
 */
export function getSprite(
  spriteName: string,
): VmConfig['sprites'][string] | null {
  const config = loadVmConfig();
  return config.sprites[spriteName] ?? null;
}

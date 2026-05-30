/**
 * Sprites CLI helpers
 *
 * Wrapper functions for interacting with the Sprites VM platform CLI.
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

const execFileAsync = promisify(execFile);

/**
 * Run a sprite command and capture output.
 */
export async function runSpriteCmd(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('sprite', args);
    return stdout.trim();
  } catch (err: any) {
    throw new Error(
      `sprite ${args[0]} failed (exit ${err.code ?? '?'}): ${err.stderr ?? err.message}`,
    );
  }
}

/**
 * Copy a file to/from a sprite using sprite cp.
 */
export async function runSpriteCopy(
  localPath: string,
  spriteName: string,
  remotePath: string,
): Promise<void> {
  try {
    await execFileAsync('sprite', [
      'cp',
      localPath,
      `${spriteName}:${remotePath}`,
    ]);
  } catch (err: any) {
    throw new Error(
      `sprite cp failed (exit ${err.code ?? '?'}): ${err.stderr ?? err.message}`,
    );
  }
}

/**
 * Run a sprite command with inherited stdio (for interactive commands).
 */
export async function runSpriteInteractive(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('sprite', args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code !== 0)
        reject(new Error(`sprite ${args[0]} failed (exit ${code})`));
      else resolve();
    });
    proc.on('error', reject);
  });
}

/**
 * Assert that the sprite CLI is available and authenticated.
 */
export async function assertSpriteCli(): Promise<void> {
  await runSpriteCmd(['--version']).catch(() => {
    throw new Error(
      '`sprite` CLI not found. Install it from https://docs.sprites.dev and authenticate.',
    );
  });
}

/**
 * Resolve a sprite name from explicit flag, active VM config, or error.
 */
export function resolveSprite(explicitName?: string): string {
  if (explicitName) {
    return explicitName;
  }
  // TODO: Implement reading from VM config when we create vm-config.ts
  // For now, we'll require explicit name or fail
  throw new Error(
    'No sprite specified. Use --sprite <name> or set an active sprite with `trellis vm use <name>`',
  );
}

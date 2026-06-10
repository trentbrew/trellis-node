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
 * Run a remote shell command on a sprite (`bash -c`).
 * Wraps commands so flags like `mkdir -p` are not parsed as sprite CLI flags.
 */
export async function runSpriteExec(
  spriteName: string,
  shellCommand: string,
  extraArgs: string[] = [],
): Promise<string> {
  return runSpriteCmd([
    'exec',
    '-s',
    spriteName,
    ...extraArgs,
    '--',
    'bash',
    '-c',
    shellCommand,
  ]);
}

/**
 * Upload a local file to a sprite via `exec --file` (Sprites CLI has no `cp` subcommand).
 */
export async function runSpriteCopy(
  localPath: string,
  spriteName: string,
  remotePath: string,
): Promise<void> {
  try {
    await execFileAsync('sprite', [
      'exec',
      '-s',
      spriteName,
      '--file',
      `${localPath}:${remotePath}`,
      'echo',
      'uploaded',
    ]);
  } catch (err: any) {
    throw new Error(
      `sprite file upload failed (exit ${err.code ?? '?'}): ${err.stderr ?? err.message}`,
    );
  }
}

/**
 * Create a sprite if it does not already exist.
 */
export async function ensureSprite(spriteName: string): Promise<void> {
  try {
    await runSpriteCmd(['create', spriteName, '--skip-console']);
  } catch (err: any) {
    const msg = String(err.message ?? err);
    if (/already exists|duplicate|conflict/i.test(msg)) return;
    throw err;
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

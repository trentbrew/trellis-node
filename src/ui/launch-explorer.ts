/**
 * Launch the SvelteKit realtime explorer (demo/realtime-app).
 * Replaces the legacy client.html System Visualizer for `trellis ui`.
 */

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type LaunchExplorerOptions = {
  /** Repo root — ensures .trellis exists; explorer DB lives in demo/realtime-app */
  rootPath: string;
  /** SvelteKit dev port (default 4000) */
  appPort?: number;
  /** Trellis graph sidecar port (default 3920) */
  trellisPort?: number;
};

export type LaunchExplorerHandle = {
  appPort: number;
  trellisPort: number;
  appUrl: string;
  trellisUrl: string;
  stop: () => void;
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function resolveExplorerAppDir(): string {
  const candidates = [
    path.resolve(MODULE_DIR, '../../demo/realtime-app'),
    path.resolve(process.cwd(), 'demo/realtime-app'),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
  }
  throw new Error(
    'Realtime explorer app not found at demo/realtime-app.\n' +
      'Run: node scripts/sync-realtime-app.mjs',
  );
}

function which(cmd: string): string {
  return process.platform === 'win32' ? `${cmd}.cmd` : cmd;
}

export async function launchRealtimeExplorer(
  opts: LaunchExplorerOptions,
): Promise<LaunchExplorerHandle> {
  const appDir = resolveExplorerAppDir();
  const appPort = opts.appPort ?? 4000;
  const trellisPort = opts.trellisPort ?? 3920;

  if (!existsSync(path.join(appDir, 'node_modules'))) {
    console.log('Installing explorer dependencies (pnpm)…');
    await runCmd(which('pnpm'), ['install'], { cwd: appDir });
  } else {
    await runCmd(which('node'), ['scripts/ensure-trellis-build.mjs'], {
      cwd: appDir,
    });
  }

  const env = {
    ...process.env,
    TRELLIS_PORT: String(trellisPort),
    TRELLIS_REPO_ROOT: opts.rootPath,
  };

  const child = spawn(which('pnpm'), ['run', 'dev:all'], {
    cwd: appDir,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const stop = () => {
    if (!child.killed) child.kill('SIGTERM');
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on('exit', (code) => {
      if (settled) return;
      if (code != null && code !== 0) {
        settled = true;
        reject(new Error(`Explorer exited with code ${code}`));
      }
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        appPort,
        trellisPort,
        appUrl: `http://localhost:${appPort}`,
        trellisUrl: `http://localhost:${trellisPort}`,
        stop,
      });
    }, 2000);
  });
}

function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}`));
    });
  });
}

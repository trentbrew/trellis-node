import { readFileSync, realpathSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { TrellisVcsEngine } from '../engine.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Published package version (from package.json at repo root). */
export function cliVersion(): string {
  const path = resolve(here, '../../package.json');
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
    if (typeof pkg.version === 'string') return pkg.version;
  } catch {
    /* fall through */
  }
  return '0.0.0';
}

function canonicalRoot(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/** Walk up from path (or cwd) and return the nearest Trellis repo root, if any. */
export function findRepoRoot(pathOpt?: string): string | undefined {
  const start = resolve(pathOpt ?? process.cwd());
  let dir = start;
  while (true) {
    if (TrellisVcsEngine.isRepo(dir)) return canonicalRoot(dir);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Resolve a Trellis repo root from an explicit path or cwd.
 * Walks up parent directories when the starting path is inside a repo
 * (e.g. packages/opencode under a monorepo root with .trellis).
 */
export function resolveRepoRoot(pathOpt?: string): string {
  const start = resolve(pathOpt ?? process.cwd());
  const found = findRepoRoot(pathOpt);
  if (found) return found;
  failNotRepo(start, pathOpt);
}

export function failNotRepo(start: string, pathOpt?: string): never {
  console.error(chalk.red('Not a TrellisVCS repository.'));
  console.error(chalk.dim(`  looked from: ${start}`));
  if (pathOpt && resolve(pathOpt) !== process.cwd()) {
    console.error(chalk.dim(`  -p:          ${resolve(pathOpt)}`));
  }
  console.error(chalk.dim(`  cwd:         ${process.cwd()}`));
  console.error(
    chalk.dim(
      '  Hint: run from the repo root, pass -p <path>, or run `trellis init`.',
    ),
  );
  process.exit(1);
}

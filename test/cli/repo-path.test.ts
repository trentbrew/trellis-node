import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TrellisVcsEngine } from '../../src/engine.js';
import { resolveRepoRoot } from '../../src/cli/repo-path.js';

describe('resolveRepoRoot', () => {
  let root: string;
  let nested: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'trellis-cli-root-'));
    root = realpathSync(root); // Canonicalize to match resolveRepoRoot behavior
    nested = join(root, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    const eng = new TrellisVcsEngine({ rootPath: root });
    await eng.initRepo();
  });

  afterAll(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  it('finds repo from nested cwd path', () => {
    expect(resolveRepoRoot(nested)).toBe(root);
  });

  it('finds repo from explicit root path', () => {
    expect(resolveRepoRoot(root)).toBe(root);
  });
});

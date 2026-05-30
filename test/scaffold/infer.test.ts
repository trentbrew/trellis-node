/**
 * Tests for scaffold/infer.ts — project context inference
 */

import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { inferProjectContext } from '../../src/scaffold/infer.js';

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `trellis-infer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('empty directory returns high confidence with unknown ecosystem', async () => {
  const ctx = await inferProjectContext(testDir);
  expect(ctx.confidence).toBe('high');
  expect(ctx.ecosystem).toBe('unknown');
  expect(ctx.fileCount).toBe(0);
  expect(ctx.domain).toBeNull();
  expect(ctx.indicators).toEqual([]);
});

test('directory with package.json detects node ecosystem', async () => {
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'my-project',
      description: 'A test project',
      dependencies: { express: '^4.0.0' },
    }),
  );
  writeFileSync(join(testDir, 'index.js'), 'console.log("hi")');

  const ctx = await inferProjectContext(testDir);
  expect(ctx.ecosystem).toBe('node');
  expect(ctx.name).toBe('my-project');
  expect(ctx.description).toBe('A test project');
  expect(ctx.domain).toBe('api-server');
  expect(ctx.indicators).toContain('package.json');
});

test('bun project detected via @types/bun', async () => {
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'bun-app',
      devDependencies: { '@types/bun': 'latest' },
    }),
  );

  const ctx = await inferProjectContext(testDir);
  expect(ctx.ecosystem).toBe('bun');
});

test('bun project detected via engines.bun', async () => {
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'bun-app',
      engines: { bun: '>=1.0.0' },
      dependencies: {},
    }),
  );

  const ctx = await inferProjectContext(testDir);
  expect(ctx.ecosystem).toBe('bun');
});

test('react project detected as web-app domain', async () => {
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'react-app',
      dependencies: { react: '^18.0.0' },
    }),
  );

  const ctx = await inferProjectContext(testDir);
  expect(ctx.domain).toBe('web-app');
});

test('motion-canvas project detected as animation-studio', async () => {
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'anim',
      dependencies: { '@motion-canvas/core': '^3.0.0' },
    }),
  );

  const ctx = await inferProjectContext(testDir);
  expect(ctx.domain).toBe('animation-studio');
});

test('Cargo.toml detects rust ecosystem and extracts name', async () => {
  writeFileSync(
    join(testDir, 'Cargo.toml'),
    `[package]\nname = "my-rust-crate"\nversion = "0.1.0"\n`,
  );

  const ctx = await inferProjectContext(testDir);
  expect(ctx.ecosystem).toBe('rust');
  expect(ctx.name).toBe('my-rust-crate');
  expect(ctx.indicators).toContain('Cargo.toml');
});

test('go.mod detects go ecosystem', async () => {
  writeFileSync(join(testDir, 'go.mod'), 'module example.com/mymod\n\ngo 1.21\n');

  const ctx = await inferProjectContext(testDir);
  expect(ctx.ecosystem).toBe('go');
  expect(ctx.indicators).toContain('go.mod');
});

test('pyproject.toml detects python ecosystem', async () => {
  writeFileSync(join(testDir, 'pyproject.toml'), '[project]\nname = "mypy"\n');

  const ctx = await inferProjectContext(testDir);
  expect(ctx.ecosystem).toBe('python');
  expect(ctx.indicators).toContain('pyproject.toml');
});

test('README.md description extraction', async () => {
  writeFileSync(
    join(testDir, 'README.md'),
    `# My Project\n\nThis is a comprehensive tool for managing animation pipelines across distributed teams.\n`,
  );

  const ctx = await inferProjectContext(testDir);
  expect(ctx.description).toContain('comprehensive tool');
  expect(ctx.indicators).toContain('README.md');
});

test('accepts pre-computed file count to avoid double walk', async () => {
  // Create some files
  for (let i = 0; i < 10; i++) {
    writeFileSync(join(testDir, `file-${i}.txt`), `content ${i}`);
  }

  const ctx = await inferProjectContext(testDir, { precomputedFileCount: 42 });
  // Should use our provided count, not the actual 10
  expect(ctx.fileCount).toBe(42);
});

test('confidence: medium for mid-range files with no indicators', async () => {
  // Use precomputed count to simulate mid-range
  const ctx = await inferProjectContext(testDir, { precomputedFileCount: 100 });
  expect(ctx.confidence).toBe('medium');
});

test('confidence: low for very large file counts', async () => {
  const ctx = await inferProjectContext(testDir, { precomputedFileCount: 15000 });
  expect(ctx.confidence).toBe('low');
});

test('confidence: high for 1 indicator + <=500 files', async () => {
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({ name: 'test', dependencies: {} }),
  );

  const ctx = await inferProjectContext(testDir, { precomputedFileCount: 200 });
  expect(ctx.confidence).toBe('high');
});

test('confidence: medium for 1 indicator + >500 files', async () => {
  writeFileSync(
    join(testDir, 'package.json'),
    JSON.stringify({ name: 'test', dependencies: {} }),
  );

  const ctx = await inferProjectContext(testDir, { precomputedFileCount: 800 });
  expect(ctx.confidence).toBe('medium');
});

/**
 * TRL-6 — server-side relation resolve on subscription payloads.
 */
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { BetterSqliteKernelBackend } from '../../src/core/persist/better-sqlite-backend.js';
import { parseSimple } from '../../src/core/query/parser.js';
import { defineType, rel } from '../../src/schema/define.js';
import { hydrateAndResolve } from '../../src/schema/kernel-resolve.js';

const NavItem = defineType(
  'NavItem',
  { label: z.string(), order: z.number() },
  { relations: { section: rel('NavSection') } },
);

const NavSection = defineType(
  'NavSection',
  { label: z.string(), order: z.number(), collapsed: z.boolean() },
  { relations: { items: rel(() => NavItem, 'many') } },
);

describe('hydrateAndResolve (server)', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-server-resolve-'));
    kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test',
      snapshotThreshold: 0,
    });
    kernel.boot();
    kernel.createOntology(NavSection.definition);
    kernel.createOntology(NavItem.definition);
  });

  afterEach(() => {
    kernel.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('expands reverse-many relations before wire push', async () => {
    await kernel.createEntity('navsection:a', 'NavSection', {
      label: 'Workspace',
      order: 0,
      collapsed: false,
    });
    await kernel.createEntity('navitem:1', 'NavItem', {
      label: 'Overview',
      order: 0,
      section: 'navsection:a',
    });
    await kernel.createEntity('navitem:2', 'NavItem', {
      label: 'Tasks',
      order: 1,
      section: 'navsection:a',
    });

    const qr = await kernel.query(
      parseSimple('find ?e where type = "NavSection"'),
    );

    const resolved = await hydrateAndResolve(
      kernel,
      qr.bindings as Record<string, unknown>[],
      'NavSection',
      { items: true },
    );

    expect(resolved).toHaveLength(1);
    const items = (resolved[0] as { items: { label: string }[] }).items;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.label)).toEqual(['Overview', 'Tasks']);
  });

  test('passes through when resolve is omitted', async () => {
    await kernel.createEntity('navsection:a', 'NavSection', {
      label: 'Workspace',
      order: 0,
      collapsed: false,
    });

    const qr = await kernel.query(
      parseSimple('find ?e where type = "NavSection"'),
    );

    const rows = await hydrateAndResolve(
      kernel,
      qr.bindings as Record<string, unknown>[],
    );

    expect(rows[0]).toMatchObject({ id: 'navsection:a', label: 'Workspace' });
    expect((rows[0] as Record<string, unknown>).items).toBeUndefined();
  });
});

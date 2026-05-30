/**
 * Tests for P16 — Multi-repo linking, HTTP transport, cross-repo refs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { SqliteKernelBackend } from '../../src/core/persist/sqlite-backend.js';
import {
  MultiRepoManager,
  parseCrossRepoRef,
  formatCrossRepoRef,
} from '../../src/sync/multi-repo.js';
import { HttpSyncTransport, createSyncHandler } from '../../src/sync/http-transport.js';

// ---------------------------------------------------------------------------
// Cross-repo ref helpers
// ---------------------------------------------------------------------------

describe('Cross-repo ref helpers', () => {
  it('should parse a valid cross-repo ref', () => {
    const ref = parseCrossRepoRef('@backend:user:alice');
    expect(ref).not.toBeNull();
    expect(ref!.repoAlias).toBe('backend');
    expect(ref!.entityId).toBe('user:alice');
  });

  it('should return null for non-cross-repo refs', () => {
    expect(parseCrossRepoRef('user:alice')).toBeNull();
    expect(parseCrossRepoRef('')).toBeNull();
    expect(parseCrossRepoRef('@nocolon')).toBeNull();
  });

  it('should format a cross-repo ref', () => {
    expect(formatCrossRepoRef('backend', 'user:alice')).toBe('@backend:user:alice');
  });
});

// ---------------------------------------------------------------------------
// MultiRepoManager
// ---------------------------------------------------------------------------

describe('MultiRepoManager', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;
  let manager: MultiRepoManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-multirepo-'));
    kernel = new TrellisKernel({
      backend: new SqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test',
    });
    kernel.boot();
    manager = new MultiRepoManager(kernel);
  });

  afterEach(() => {
    kernel.close();
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it('should link a remote repo', async () => {
    await manager.linkRepo('backend', '/path/to/backend', 'Backend API');
    const repos = manager.listLinkedRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0].alias).toBe('backend');
    expect(repos[0].location).toBe('/path/to/backend');
  });

  it('should get a linked repo by alias', async () => {
    await manager.linkRepo('shared', 'https://github.com/org/shared');
    const repo = manager.getLinkedRepo('shared');
    expect(repo).not.toBeNull();
    expect(repo!.location).toBe('https://github.com/org/shared');
  });

  it('should reject duplicate aliases', async () => {
    await manager.linkRepo('dup', '/path/a');
    await expect(manager.linkRepo('dup', '/path/b')).rejects.toThrow('already linked');
  });

  it('should unlink a repo', async () => {
    await manager.linkRepo('temp', '/tmp/repo');
    await manager.unlinkRepo('temp');
    expect(manager.listLinkedRepos()).toHaveLength(0);
  });

  it('should add cross-repo links', async () => {
    await manager.linkRepo('backend', '/path/to/backend');
    await kernel.createEntity('proj:frontend', 'Project', { name: 'Frontend' });

    await manager.addCrossRepoLink('proj:frontend', 'dependsOn', 'backend', 'lib:api-client');

    const links = manager.getCrossRepoLinks('proj:frontend');
    expect(links).toHaveLength(1);
    expect(links[0].attribute).toBe('dependsOn');
    expect(links[0].ref.repoAlias).toBe('backend');
    expect(links[0].ref.entityId).toBe('lib:api-client');
  });

  it('should remove cross-repo links', async () => {
    await manager.linkRepo('backend', '/path/to/backend');
    await kernel.createEntity('proj:frontend', 'Project', { name: 'Frontend' });

    await manager.addCrossRepoLink('proj:frontend', 'dependsOn', 'backend', 'lib:api');
    await manager.removeCrossRepoLink('proj:frontend', 'dependsOn', 'backend', 'lib:api');

    const links = manager.getCrossRepoLinks('proj:frontend');
    expect(links).toHaveLength(0);
  });

  it('should reject cross-repo links to unlinked repos', async () => {
    await kernel.createEntity('proj:frontend', 'Project', { name: 'Frontend' });
    await expect(
      manager.addCrossRepoLink('proj:frontend', 'dependsOn', 'nonexistent', 'lib:api'),
    ).rejects.toThrow('not linked');
  });

  it('should find references to a remote entity', async () => {
    await manager.linkRepo('shared', '/path/to/shared');
    await kernel.createEntity('proj:a', 'Project', { name: 'A' });
    await kernel.createEntity('proj:b', 'Project', { name: 'B' });

    await manager.addCrossRepoLink('proj:a', 'uses', 'shared', 'lib:utils');
    await manager.addCrossRepoLink('proj:b', 'uses', 'shared', 'lib:utils');

    const refs = manager.findReferencesTo('shared', 'lib:utils');
    expect(refs).toHaveLength(2);
  });

  it('should mark repo as synced', async () => {
    await manager.linkRepo('remote', 'http://example.com');
    await manager.markSynced('remote');

    const repo = manager.getLinkedRepo('remote');
    expect(repo!.lastSyncedAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// HttpSyncTransport
// ---------------------------------------------------------------------------

describe('HttpSyncTransport', () => {
  it('should create and configure transport', () => {
    const transport = new HttpSyncTransport('peer-a');
    transport.addPeer('peer-b', 'http://localhost:4200');
    expect(transport.peers()).toHaveLength(1);
    expect(transport.peers()[0].id).toBe('peer-b');
  });

  it('should remove peers', () => {
    const transport = new HttpSyncTransport('peer-a');
    transport.addPeer('peer-b', 'http://localhost:4200');
    transport.removePeer('peer-b');
    expect(transport.peers()).toHaveLength(0);
  });

  it('should receive messages', () => {
    const transport = new HttpSyncTransport('peer-a');
    const received: any[] = [];
    transport.onMessage((msg) => received.push(msg));

    transport.receiveMessage({
      type: 'have',
      peerId: 'peer-b',
      heads: { main: 'hash123' },
      opCount: 5,
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('have');
    expect(received[0].peerId).toBe('peer-b');
  });

  it('should track peers from received messages', () => {
    const transport = new HttpSyncTransport('peer-a');
    transport.onMessage(() => {});

    transport.receiveMessage({
      type: 'ack',
      peerId: 'peer-c',
      integrated: [],
    });

    const peers = transport.peers();
    expect(peers.some((p) => p.id === 'peer-c')).toBe(true);
  });

  it('should create sync handler for HTTP routes', () => {
    const transport = new HttpSyncTransport('peer-a');
    const handler = createSyncHandler(transport);
    expect(typeof handler).toBe('function');

    // Test peers endpoint
    const peersReq = new Request('http://localhost:4200/sync/peers');
    const resp = handler(peersReq);
    expect(resp).not.toBeNull();
  });

  it('should return null for non-sync routes', () => {
    const transport = new HttpSyncTransport('peer-a');
    const handler = createSyncHandler(transport);
    const req = new Request('http://localhost:4200/other');
    expect(handler(req)).toBeNull();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { TrellisClient } from '../../src/client/vcs-client.js';
import { MemorySyncRoom } from '../../src/sync/memory-room.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const TMP = join(__dirname, '__tmp_vcs_client_test');
const REPO_PATH = join(TMP, 'repo');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(REPO_PATH, { recursive: true });
});

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

describe('TrellisClient (local mode)', () => {
  it('opens a repo and creates an issue', async () => {
    const client = await TrellisClient.open({ repo: REPO_PATH });

    const op = await client.createIssue('Fix auth', {
      priority: 'high',
    });

    expect(op.kind).toBe('vcs:issueCreate');
    expect(op.vcs?.issueTitle).toBe('Fix auth');

    const issues = client.listIssues();
    expect(issues.length).toBe(1);
    expect(issues[0].title).toBe('Fix auth');

    client.close();
  });

  it('emits reactive updates via subscribe', async () => {
    const client = await TrellisClient.open({ repo: REPO_PATH });

    const calls: unknown[] = [];
    const unsub = client.subscribe('issues', (issues) => {
      calls.push(issues);
    });

    // Should receive initial value immediately
    expect(calls.length).toBe(1);
    expect((calls[0] as any[]).length).toBe(0);

    await client.createIssue('New task', { priority: 'medium' });

    // Should receive updated value after createIssue
    expect(calls.length).toBe(2);
    expect((calls[1] as any[]).length).toBe(1);

    unsub();
    client.close();
  });

  it('emits op events for new ops', async () => {
    const client = await TrellisClient.open({ repo: REPO_PATH });

    const ops: any[] = [];
    const unsub = client.on('op', (op) => {
      ops.push(op);
    });

    await client.createIssue('Tracked issue');

    // createIssue triggers vcs:issueCreate + vcs:branchAdvance
    expect(ops.length).toBe(2);
    expect(ops[0].kind).toBe('vcs:issueCreate');
    expect(ops[1].kind).toBe('vcs:branchAdvance');

    unsub();
    client.close();
  });

  it('maps lane shorthand to laneId in issue id', async () => {
    const client = await TrellisClient.open({ repo: REPO_PATH });

    const op = await client.createIssue('Lane test', {
      lane: 'agent:cursor',
    } as any);

    // laneId scopes the issue ID, e.g. issue:agent:cursor:1
    expect(op.vcs?.issueId).toMatch(/^issue:agent:cursor:/);
    client.close();
  });

  it('exposes signals for framework adapters', async () => {
    const client = await TrellisClient.open({ repo: REPO_PATH });

    const signal = client.opsSignal;
    // Fresh repo has 0 ops before any writes
    const initialCount = signal.value.length;
    expect(initialCount).toBe(0);

    // createIssue emits vcs:issueCreate + vcs:branchAdvance
    await client.createIssue('Signal test');
    expect(signal.value.length).toBe(initialCount + 2);

    client.close();
  });
});

describe('TrellisClient (room sync)', () => {
  it('propagates issues to peers via room relay without manual sync', async () => {
    const room = new MemorySyncRoom('demo-room', 'Demo Room');

    const clientA = await TrellisClient.open({
      repo: join(TMP, 'peer-a'),
      agentId: 'alice',
      persist: 'memory',
      sync: {
        transport: room.connectPeer('alice', 'Alice'),
        roomId: 'demo-room',
        pushDebounceMs: 50,
      },
    });
    const clientB = await TrellisClient.open({
      repo: join(TMP, 'peer-b'),
      agentId: 'bob',
      persist: 'memory',
      sync: {
        transport: room.connectPeer('bob', 'Bob'),
        roomId: 'demo-room',
        pushDebounceMs: 50,
      },
    });

    const bUpdates: unknown[] = [];
    clientB.subscribe('issues', (issues) => bUpdates.push(issues));

    await clientA.createIssue('Fix auth', { lane: 'lane-a' });
    await sleep(150);

    expect(clientB.listIssues().some((i) => i.title === 'Fix auth')).toBe(true);
    expect(bUpdates.length).toBeGreaterThan(1);

    clientA.close();
    clientB.close();
  });

  it('reports sync status through subscribe', async () => {
    const room = new MemorySyncRoom();

    const client = await TrellisClient.open({
      repo: join(TMP, 'sync-status'),
      agentId: 'peer-a',
      persist: 'memory',
      sync: {
        transport: room.connectPeer('peer-a'),
        pushDebounceMs: 50,
      },
    });

    const statuses: unknown[] = [];
    client.subscribe('syncStatus', (status) => statuses.push(status));

    expect(statuses.length).toBeGreaterThan(0);
    const latest = statuses[statuses.length - 1] as {
      connected: boolean;
      synced: boolean;
    };
    expect(latest.connected).toBe(true);
    expect(latest.synced).toBe(true);

    client.close();
  });
});

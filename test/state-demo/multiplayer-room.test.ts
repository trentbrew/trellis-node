import { describe, it, expect } from 'vitest';
import { MultiplayerRoom } from '../../demo/state-demo/multiplayer-room.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('MultiplayerRoom', () => {
  it('syncs an issue from alice to bob', async () => {
    const room = new MultiplayerRoom({ pushDebounceMs: 20 });

    await room.alice.addIssue('Fix auth', 'high');
    await sleep(120);

    expect(room.bob.getIssues().some((i) => i.title === 'Fix auth')).toBe(true);
    expect(room.getMergedOps().length).toBeGreaterThan(0);
  });

  it('syncs close ops across peers', async () => {
    const room = new MultiplayerRoom({ pushDebounceMs: 20 });

    const create = await room.alice.addIssue('Buy milk', 'medium');
    await sleep(120);
    const id = create.vcs?.issueId;
    expect(id).toBeTruthy();

    await room.alice.setIssueClosed(id!, true);
    await sleep(120);

    const bobIssue = room.bob.getIssues().find((i) => i.id === id);
    expect(bobIssue?.status).toBe('closed');
  });
});

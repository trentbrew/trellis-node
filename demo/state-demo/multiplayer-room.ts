import { MemorySyncRoom } from '../../src/sync/memory-room.js';
import { SyncEngine } from '../../src/sync/sync-engine.js';
import type { VcsOp } from '../../src/vcs/types.js';
import { DemoSession, mergeOps } from './demo-session.js';
import type { DemoSessionState } from './demo-session.js';

export type MultiplayerRoomState = {
  alice: DemoSessionState;
  bob: DemoSessionState;
  mergedOps: VcsOp[];
};

export type MultiplayerRoomOptions = {
  onChange?: (state: MultiplayerRoomState) => void;
  pushDebounceMs?: number;
};

/**
 * Two peer todo sessions over an in-process MemorySyncRoom (browser-safe).
 */
export class MultiplayerRoom {
  readonly alice: DemoSession;
  readonly bob: DemoSession;

  private room = new MemorySyncRoom('docs-state-demo', 'Docs state');
  private engineAlice: SyncEngine;
  private engineBob: SyncEngine;
  private roomPeerId: string;
  private onChange?: (state: MultiplayerRoomState) => void;
  private pushDebounceMs: number;
  private pushTimer?: ReturnType<typeof setTimeout>;
  private flushing = false;

  constructor(opts: MultiplayerRoomOptions = {}) {
    this.onChange = opts.onChange;
    this.pushDebounceMs = opts.pushDebounceMs ?? 80;
    this.roomPeerId = this.room.getRoomPeer().id;

    const scheduleSync = () => this.scheduleSync();

    this.alice = new DemoSession({
      agentId: 'agent:alice',
      onChange: () => this.emit(),
      onAfterWrite: scheduleSync,
    });
    this.bob = new DemoSession({
      agentId: 'agent:bob',
      onChange: () => this.emit(),
      onAfterWrite: scheduleSync,
    });

    this.engineAlice = new SyncEngine({
      localPeerId: 'alice',
      transport: this.room.connectPeer('alice', 'Alice'),
      getLocalOps: () => this.alice.getOps(),
      onOpsReceived: (ops) => {
        this.alice.integrate(ops);
      },
      branchPolicy: { linear: false },
    });

    this.engineBob = new SyncEngine({
      localPeerId: 'bob',
      transport: this.room.connectPeer('bob', 'Bob'),
      getLocalOps: () => this.bob.getOps(),
      onOpsReceived: (ops) => {
        this.bob.integrate(ops);
      },
      branchPolicy: { linear: false },
    });
  }

  getMergedOps(): VcsOp[] {
    return mergeOps(this.alice.getOps(), this.bob.getOps());
  }

  private emit(): void {
    this.onChange?.({
      alice: { ops: this.alice.getOps(), issues: this.alice.getIssues() },
      bob: { ops: this.bob.getOps(), issues: this.bob.getIssues() },
      mergedOps: this.getMergedOps(),
    });
  }

  private scheduleSync(): void {
    if (this.pushTimer !== undefined) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined;
      void this.flushSync();
    }, this.pushDebounceMs);
  }

  /** Push/pull both peers through the room relay. */
  async flushSync(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      await this.engineAlice.pushTo(this.roomPeerId);
      await this.engineBob.pullAllFrom(this.roomPeerId);
      await this.engineBob.pushTo(this.roomPeerId);
      await this.engineAlice.pullAllFrom(this.roomPeerId);
      this.emit();
    } finally {
      this.flushing = false;
    }
  }
}

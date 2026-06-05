/**
 * RealtimeText — a compact RGA-style sequence CRDT for collaborative text.
 *
 * Each character is a node with a globally-unique id (`<lamport>@<peerId>`) and
 * an `after` pointer to the node it follows. Concurrent inserts sharing an
 * anchor are ordered deterministically (higher lamport first, peer id as
 * tiebreak), so all replicas converge regardless of delivery order. Deletes are
 * tombstones, making them idempotent and commutative.
 *
 * This is intentionally minimal — enough for a genuine multiplayer editor demo
 * without the weight of a full production CRDT (no block compaction, GC, or
 * rich formatting).
 */

import type { RealtimeRoom } from './room.js';

export interface TextNode {
  id: string;
  ch: string;
  after: string | null;
  deleted: boolean;
}

export type TextOp =
  | { op: 'ins'; id: string; ch: string; after: string | null }
  | { op: 'del'; id: string };

export interface RealtimeTextOptions {
  peerId: string;
  /** Optional room binding for automatic op + state sync. */
  room?: RealtimeRoom;
  /** Broadcast channel name when bound to a room. Default `text`. */
  channel?: string;
}

interface ParsedId {
  counter: number;
  peer: string;
}

function parseId(id: string): ParsedId {
  const at = id.indexOf('@');
  return {
    counter: Number(id.slice(0, at)),
    peer: id.slice(at + 1),
  };
}

/** RGA sibling order: higher lamport first, peer id as deterministic tiebreak. */
function compareSiblings(a: string, b: string): number {
  const pa = parseId(a);
  const pb = parseId(b);
  if (pa.counter !== pb.counter) return pb.counter - pa.counter;
  return pb.peer.localeCompare(pa.peer);
}

export class RealtimeText {
  private nodes = new Map<string, TextNode>();
  private counter = 0;
  private peerId: string;
  private listeners = new Set<(text: string) => void>();
  private room?: RealtimeRoom;
  private channel: string;
  private unsubscribe?: () => void;

  constructor(opts: RealtimeTextOptions) {
    this.peerId = opts.peerId;
    this.room = opts.room;
    this.channel = opts.channel ?? 'text';

    if (this.room) {
      this.unsubscribe = this.room.on(this.channel, (e) => {
        if (e.from === this.peerId) return;
        this.onRemote(e.event, e.payload);
      });
      // Ask existing peers for their current document.
      this.room.broadcast(this.channel, 'state-req', {});
    }
  }

  /** Materialized visible text. */
  toString(): string {
    return this.visibleNodes()
      .map((n) => n.ch)
      .join('');
  }

  /** Current length of visible text. */
  get length(): number {
    return this.visibleNodes().length;
  }

  /** Insert a string at a visible index. Broadcasts ops when room-bound. */
  insert(index: number, str: string): TextOp[] {
    if (str.length === 0) return [];
    const visible = this.visibleNodes();
    let after = index <= 0 ? null : visible[index - 1]?.id ?? null;
    const ops: TextOp[] = [];

    for (const ch of str) {
      const id = this.nextId();
      const node: TextNode = { id, ch, after, deleted: false };
      this.nodes.set(id, node);
      ops.push({ op: 'ins', id, ch, after });
      after = id;
    }

    this.emit();
    this.publish(ops);
    return ops;
  }

  /** Delete `count` visible characters starting at `index`. */
  delete(index: number, count = 1): TextOp[] {
    if (count <= 0) return [];
    const visible = this.visibleNodes();
    const ops: TextOp[] = [];

    for (let k = 0; k < count; k++) {
      const target = visible[index + k];
      if (!target) break;
      const node = this.nodes.get(target.id);
      if (node && !node.deleted) {
        node.deleted = true;
        ops.push({ op: 'del', id: node.id });
      }
    }

    if (ops.length > 0) {
      this.emit();
      this.publish(ops);
    }
    return ops;
  }

  /** Apply a single remote op. Returns true if the document changed. */
  applyOp(op: TextOp): boolean {
    if (op.op === 'ins') {
      if (this.nodes.has(op.id)) return false;
      this.bumpCounter(op.id);
      this.nodes.set(op.id, {
        id: op.id,
        ch: op.ch,
        after: op.after,
        deleted: false,
      });
      return true;
    }
    // delete
    const node = this.nodes.get(op.id);
    if (!node || node.deleted) return false;
    node.deleted = true;
    return true;
  }

  /** Apply a batch of remote ops, emitting once. */
  applyOps(ops: TextOp[]): void {
    let changed = false;
    for (const op of ops) {
      if (this.applyOp(op)) changed = true;
    }
    if (changed) this.emit();
  }

  /** Snapshot of all nodes (including tombstones) for state sync. */
  getNodes(): TextNode[] {
    return [...this.nodes.values()];
  }

  /** Merge a remote snapshot of nodes. */
  mergeNodes(nodes: TextNode[]): void {
    let changed = false;
    for (const incoming of nodes) {
      this.bumpCounter(incoming.id);
      const existing = this.nodes.get(incoming.id);
      if (!existing) {
        this.nodes.set(incoming.id, { ...incoming });
        changed = true;
      } else if (incoming.deleted && !existing.deleted) {
        existing.deleted = true;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** Subscribe to text changes. Returns an unsubscribe fn. */
  onChange(cb: (text: string) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Detach room bindings. */
  dispose(): void {
    this.unsubscribe?.();
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private onRemote(event: string, payload: unknown): void {
    switch (event) {
      case 'op':
        this.applyOps(payload as TextOp[]);
        break;
      case 'state-req':
        // Reply with our full document so the newcomer converges.
        this.room?.broadcast(this.channel, 'state', this.getNodes());
        break;
      case 'state':
        this.mergeNodes(payload as TextNode[]);
        break;
    }
  }

  private publish(ops: TextOp[]): void {
    this.room?.broadcast(this.channel, 'op', ops);
  }

  private visibleNodes(): TextNode[] {
    const children = new Map<string | null, TextNode[]>();
    for (const node of this.nodes.values()) {
      const list = children.get(node.after);
      if (list) list.push(node);
      else children.set(node.after, [node]);
    }
    for (const list of children.values()) {
      list.sort((a, b) => compareSiblings(a.id, b.id));
    }

    const result: TextNode[] = [];
    const stack: TextNode[] = [...(children.get(null) ?? [])].reverse();
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (!node.deleted) result.push(node);
      const kids = children.get(node.id);
      if (kids) {
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
    }
    return result;
  }

  private nextId(): string {
    this.counter += 1;
    return `${this.counter}@${this.peerId}`;
  }

  private bumpCounter(id: string): void {
    const { counter } = parseId(id);
    if (Number.isFinite(counter) && counter > this.counter) {
      this.counter = counter;
    }
  }

  private emit(): void {
    const text = this.toString();
    for (const cb of this.listeners) {
      try {
        cb(text);
      } catch {
        /* ignore */
      }
    }
  }
}

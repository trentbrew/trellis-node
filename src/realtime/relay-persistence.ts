/**
 * In-memory persistence for a WebSocket relay hub (demo / dev).
 *
 * Retains durable-enough session state: latest presence per peer, chat tail,
 * and collaborative text (snapshot preferred, else op tail). Not the VCS op
 * log — reset when the relay process stops.
 */

import type { RealtimeMessage } from './types.js';

export const DEFAULT_MAX_CHAT = 200;
export const DEFAULT_MAX_TEXT_OPS = 2000;

type PresenceMsg = Extract<RealtimeMessage, { t: 'presence' }>;
type BroadcastMsg = Extract<RealtimeMessage, { t: 'msg' }>;

/**
 * Dedup key for a chat broadcast. Prefers the sender-assigned stable `id`
 * (a grow-only-set member). Falls back to `from:ts` for legacy frames without
 * an id so they still dedup deterministically.
 */
function chatKey(msg: BroadcastMsg): string {
  return msg.id ?? `${msg.from}:${msg.ts}`;
}

/** Stable secondary sort key for equal-timestamp replay frames. */
function tieKey(msg: RealtimeMessage): string {
  if (msg.t === 'msg') return chatKey(msg);
  if (msg.t === 'presence' || msg.t === 'bye') return msg.from;
  return '';
}

function messageTs(msg: RealtimeMessage): number {
  if (msg.t === 'presence' || msg.t === 'bye' || msg.t === 'msg') {
    return msg.ts;
  }
  return 0;
}

export interface RelayPersistenceOptions {
  maxChat?: number;
  maxTextOps?: number;
}

/**
 * Records relay traffic and builds ordered replay batches for newcomers.
 */
export class RelayPersistence {
  private maxChat: number;
  private maxTextOps: number;
  private presence = new Map<string, PresenceMsg>();
  /** Chat is a grow-only set keyed by {@link chatKey} — dedup on record. */
  private chatLog: BroadcastMsg[] = [];
  private chatKeys = new Set<string>();
  private textSnapshot: BroadcastMsg | null = null;
  private textOps: BroadcastMsg[] = [];

  constructor(opts: RelayPersistenceOptions = {}) {
    this.maxChat = opts.maxChat ?? DEFAULT_MAX_CHAT;
    this.maxTextOps = opts.maxTextOps ?? DEFAULT_MAX_TEXT_OPS;
  }

  /** Record an inbound client message (skip `hello` / `replay`). */
  record(message: RealtimeMessage): void {
    if (message.v !== 1) return;

    switch (message.t) {
      case 'hello':
        return;
      case 'replay':
        return;
      case 'presence':
        this.presence.set(message.from, message);
        return;
      case 'bye':
        this.presence.delete(message.from);
        return;
      case 'msg':
        this.recordBroadcast(message);
        return;
    }
  }

  /** Ordered messages to replay to a peer that just connected. */
  buildReplay(): RealtimeMessage[] {
    const out: RealtimeMessage[] = [
      ...this.presence.values(),
      ...this.chatLog,
    ];
    if (this.textSnapshot) {
      out.push(this.textSnapshot);
    } else {
      out.push(...this.textOps);
    }
    out.sort((a, b) => {
      const dt = messageTs(a) - messageTs(b);
      if (dt !== 0) return dt;
      // Deterministic tie-break so equal-ts chat replays in a stable order.
      return tieKey(a).localeCompare(tieKey(b));
    });
    return out;
  }

  getPresenceCount(): number {
    return this.presence.size;
  }

  getChatCount(): number {
    return this.chatLog.length;
  }

  hasTextSnapshot(): boolean {
    return this.textSnapshot !== null;
  }

  private recordBroadcast(message: BroadcastMsg): void {
    if (message.channel === 'chat' && message.event === 'message') {
      const key = chatKey(message);
      if (this.chatKeys.has(key)) return; // grow-only: ignore duplicate
      this.chatKeys.add(key);
      this.chatLog.push(message);
      if (this.chatLog.length > this.maxChat) {
        const evicted = this.chatLog.splice(0, this.chatLog.length - this.maxChat);
        for (const m of evicted) this.chatKeys.delete(chatKey(m));
      }
      return;
    }

    if (message.channel === 'text' && message.event === 'state') {
      this.textSnapshot = message;
      this.textOps = [];
      return;
    }

    if (message.channel === 'text' && message.event === 'op') {
      if (this.textSnapshot) return;
      this.textOps.push(message);
      if (this.textOps.length > this.maxTextOps) {
        this.textOps.splice(0, this.textOps.length - this.maxTextOps);
      }
    }
  }
}

/**
 * Ephemeral typing indicators over a RealtimeRoom broadcast channel.
 * Not persisted — uses transient `typing` events (not PersistentChannel).
 */

import type { RealtimeRoom } from 'trellis/realtime';

export interface TypingPeer {
  id: string;
  name: string;
  color: string;
}

const TYPING_TTL_MS = 2500;
const PING_DEBOUNCE_MS = 400;

export function createTypingTracker(
  room: RealtimeRoom,
  self: { peerId: string; name: string; color: string },
): {
  /** Call on draft input — debounced broadcast. */
  ping: () => void;
  /** Clear typing immediately (call on send / empty draft). */
  stop: () => void;
  /** Subscribe to who's typing (excludes self). */
  subscribe: (cb: (peers: TypingPeer[]) => void) => () => void;
  dispose: () => void;
} {
  const active = new Map<string, TypingPeer & { until: number }>();
  const listeners = new Set<(peers: TypingPeer[]) => void>();
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPing = 0;

  const prune = () => {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of active) {
      if (peer.until < now) {
        active.delete(id);
        changed = true;
      }
    }
    if (changed) emit();
  };

  const emit = () => {
    const list = [...active.values()]
      .filter((p) => p.id !== self.peerId)
      .map(({ id, name, color }) => ({ id, name, color }));
    for (const cb of listeners) cb(list);
  };

  const unsub = room.on('chat', (event) => {
    if (event.from === self.peerId) return;
    if (event.event === 'typing-stop') {
      if (active.delete(event.from)) emit();
      return;
    }
    if (event.event !== 'typing') return;
    const payload = event.payload as { name?: string; color?: string };
    active.set(event.from, {
      id: event.from,
      name: payload.name ?? event.from,
      color: payload.color ?? '#6d5bfa',
      until: Date.now() + TYPING_TTL_MS,
    });
    emit();
  });

  const pruneTimer = setInterval(prune, 500);

  const ping = () => {
    if (pingTimer) clearTimeout(pingTimer);
    pingTimer = setTimeout(() => {
      const now = Date.now();
      if (now - lastPing < PING_DEBOUNCE_MS) return;
      lastPing = now;
      room.broadcast('chat', 'typing', { name: self.name, color: self.color });
    }, 80);
  };

  const stop = () => {
    if (pingTimer) {
      clearTimeout(pingTimer);
      pingTimer = null;
    }
    room.broadcast('chat', 'typing-stop', {});
  };

  return {
    ping,
    stop,
    subscribe(cb) {
      listeners.add(cb);
      cb([]);
      return () => listeners.delete(cb);
    },
    dispose() {
      unsub();
      clearInterval(pruneTimer);
      if (pingTimer) clearTimeout(pingTimer);
      listeners.clear();
      active.clear();
    },
  };
}

/** Format typing peers for the UI footer. */
export function formatTyping(peers: TypingPeer[]): string {
  if (peers.length === 0) return '';
  const names = peers.map((p) => p.name);
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)} are typing…`;
}

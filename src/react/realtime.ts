/**
 * Trellis React — Realtime / Signal bindings
 *
 * Framework adapter that binds the framework-agnostic {@link Signal} reactive
 * primitive and {@link RealtimeRoom} presence/broadcast engine into React.
 *
 * The whole adapter is intentionally thin: `Signal.subscribe` already matches
 * React's `useSyncExternalStore` contract (subscribe + snapshot), so there is
 * no React-specific sync logic to maintain.
 *
 *   import { useRoom } from 'trellis/react';
 *   import { RealtimeRoom, WebSocketRelayTransport } from 'trellis/realtime';
 *
 *   const { presence, others, room } = useRoom(() =>
 *     RealtimeRoom.join({
 *       transport: new WebSocketRelayTransport({ id, url: 'ws://localhost:8231/rt' }),
 *       initialPresence: { name: 'Ada', color: '#6d5bfa' },
 *     }),
 *   );
 *
 * @module trellis/react
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Signal } from '../client/reactive.js';
import type { RealtimeRoom } from '../realtime/room.js';
import type { PresencePeer, PresenceState } from '../realtime/types.js';

// ---------------------------------------------------------------------------
// useSignal — bind any Signal<T> into React render state
// ---------------------------------------------------------------------------

/**
 * Subscribe to a {@link Signal} and re-render when its value changes.
 *
 * ```tsx
 * const peers = useSignal(room.presenceSignal);
 * ```
 */
export function useSignal<T>(signal: Signal<T>): T {
  return useSyncExternalStore(
    (onStoreChange) => signal.subscribe(() => onStoreChange()),
    () => signal.peek(),
    () => signal.peek(),
  );
}

// ---------------------------------------------------------------------------
// useRoom — own a RealtimeRoom for a component's lifetime
// ---------------------------------------------------------------------------

export interface RoomHandle<P extends PresenceState = PresenceState> {
  /** The live room, or `null` before the mount effect has created it. */
  room: RealtimeRoom<P> | null;
  /** All peers including self (self first), reactive. */
  presence: PresencePeer<P>[];
  /** Peers excluding self, reactive. */
  others: PresencePeer<P>[];
}

/**
 * Create and own a {@link RealtimeRoom} for the lifetime of the component.
 *
 * `create` is called once on mount; the room is torn down (`room.leave()`) on
 * unmount. Presence updates are streamed into React state. Provide `deps` to
 * rebuild the room (e.g. when the room id or transport URL changes).
 *
 * ```tsx
 * const { presence, others, room } = useRoom(
 *   () => RealtimeRoom.join({ transport, initialPresence: { name } }),
 *   [roomId],
 * );
 * room?.broadcast('chat', 'message', { text });
 * ```
 */
export function useRoom<P extends PresenceState = PresenceState>(
  create: () => RealtimeRoom<P>,
  deps: ReadonlyArray<unknown> = [],
): RoomHandle<P> {
  const [room, setRoom] = useState<RealtimeRoom<P> | null>(null);
  const [presence, setPresence] = useState<PresencePeer<P>[]>([]);

  useEffect(() => {
    const r = create();
    setRoom(r);
    const unsub = r.presenceSignal.subscribe(setPresence);
    return () => {
      unsub();
      r.leave();
      setRoom(null);
      setPresence([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    room,
    presence,
    others: presence.filter((p) => !p.self),
  };
}

// ---------------------------------------------------------------------------
// usePresence — presence-only view of an already-created room
// ---------------------------------------------------------------------------

/**
 * Stream presence from a room you already own. Returns `[]` while `room` is
 * `null`. Use {@link useRoom} unless you manage the room's lifecycle yourself.
 */
export function usePresence<P extends PresenceState = PresenceState>(
  room: RealtimeRoom<P> | null | undefined,
): PresencePeer<P>[] {
  const [presence, setPresence] = useState<PresencePeer<P>[]>(
    () => room?.getPresence() ?? [],
  );

  useEffect(() => {
    if (!room) {
      setPresence([]);
      return;
    }
    return room.presenceSignal.subscribe(setPresence);
  }, [room]);

  return presence;
}

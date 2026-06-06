/**
 * Trellis Vue — Realtime / Signal bindings
 *
 * Framework adapter that binds the framework-agnostic {@link Signal} reactive
 * primitive and {@link RealtimeRoom} presence/broadcast engine into Vue 3's
 * reactivity system.
 *
 * A `Signal` is bridged into a `shallowRef`; subscriptions are torn down via
 * `onScopeDispose`, so these composables are safe inside `setup()` and any
 * effect scope.
 *
 *   import { useRoom } from 'trellis/vue';
 *   import { RealtimeRoom, WebSocketRelayTransport } from 'trellis/realtime';
 *
 *   const { presence, others, room } = useRoom(() =>
 *     RealtimeRoom.join({
 *       transport: new WebSocketRelayTransport({ id, url: 'ws://localhost:8231/rt' }),
 *       initialPresence: { name: 'Ada', color: '#6d5bfa' },
 *     }),
 *   );
 *
 * @module trellis/vue
 */

import {
  computed,
  onScopeDispose,
  shallowRef,
  type ComputedRef,
  type Ref,
} from 'vue';
import type { Signal } from '../client/reactive.js';
import type { RealtimeRoom } from '../realtime/room.js';
import type { PresencePeer, PresenceState } from '../realtime/types.js';

// ---------------------------------------------------------------------------
// useSignal — bridge any Signal<T> into a Vue ref
// ---------------------------------------------------------------------------

/**
 * Mirror a {@link Signal} into a read-only Vue ref. The subscription is
 * disposed automatically when the surrounding scope is torn down.
 *
 * ```ts
 * const peers = useSignal(room.presenceSignal);
 * ```
 */
export function useSignal<T>(signal: Signal<T>): Readonly<Ref<T>> {
  const state = shallowRef(signal.peek()) as Ref<T>;
  const unsubscribe = signal.subscribe((value) => {
    state.value = value;
  });
  onScopeDispose(unsubscribe);
  return state as Readonly<Ref<T>>;
}

// ---------------------------------------------------------------------------
// useRoom — own a RealtimeRoom for the current scope
// ---------------------------------------------------------------------------

export interface RoomHandle<P extends PresenceState = PresenceState> {
  /** The live room. Created eagerly in `setup()`. */
  room: RealtimeRoom<P>;
  /** All peers including self (self first), reactive. */
  presence: Readonly<Ref<PresencePeer<P>[]>>;
  /** Peers excluding self, reactive. */
  others: ComputedRef<PresencePeer<P>[]>;
}

/**
 * Create and own a {@link RealtimeRoom} for the current effect scope.
 *
 * `create` runs once (during `setup()`); the room is torn down (`room.leave()`)
 * on scope dispose.
 *
 * ```ts
 * const { presence, others, room } = useRoom(() =>
 *   RealtimeRoom.join({ transport, initialPresence: { name } }),
 * );
 * room.broadcast('chat', 'message', { text });
 * ```
 */
export function useRoom<P extends PresenceState = PresenceState>(
  create: () => RealtimeRoom<P>,
): RoomHandle<P> {
  const room = create();
  const presence = shallowRef<PresencePeer<P>[]>(room.getPresence());

  const unsubscribe = room.presenceSignal.subscribe((peers) => {
    presence.value = peers;
  });

  onScopeDispose(() => {
    unsubscribe();
    room.leave();
  });

  return {
    room,
    presence: presence as Readonly<Ref<PresencePeer<P>[]>>,
    others: computed(() => presence.value.filter((p) => !p.self)),
  };
}

// ---------------------------------------------------------------------------
// usePresence — presence-only view of an already-created room
// ---------------------------------------------------------------------------

/**
 * Stream presence from a room you already own into a read-only ref. Use
 * {@link useRoom} unless you manage the room's lifecycle yourself.
 */
export function usePresence<P extends PresenceState = PresenceState>(
  room: RealtimeRoom<P>,
): Readonly<Ref<PresencePeer<P>[]>> {
  return useSignal(room.presenceSignal);
}

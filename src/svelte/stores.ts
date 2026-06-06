/**
 * Trellis Svelte — Realtime / Signal bindings
 *
 * Framework adapter that exposes the framework-agnostic {@link Signal} and
 * {@link RealtimeRoom} through the Svelte store contract.
 *
 * Svelte's `$store` auto-subscription depends only on the store *contract*
 * (`subscribe(run) => unsubscribe`, with `run` invoked immediately), not on
 * importing anything from `svelte`. `Signal.subscribe` already matches that
 * contract verbatim, so this adapter takes no dependency on the Svelte package
 * or compiler — it stays plain `.ts` and works across Svelte 4/5.
 *
 *   import { createRoom } from 'trellis/svelte';
 *   import { RealtimeRoom, WebSocketRelayTransport } from 'trellis/svelte';
 *
 *   const { presence, others, room, destroy } = createRoom(() =>
 *     RealtimeRoom.join({
 *       transport: new WebSocketRelayTransport({ id, url: 'ws://localhost:8231/rt' }),
 *       initialPresence: { name: 'Ada', color: '#6d5bfa' },
 *     }),
 *   );
 *   onDestroy(destroy);
 *   // In markup: {#each $presence as peer}…{/each}
 *
 * @module trellis/svelte
 */

import type { Signal } from '../client/reactive.js';
import type { RealtimeRoom } from '../realtime/room.js';
import type { PresencePeer, PresenceState } from '../realtime/types.js';

/**
 * Minimal Svelte store contract (a structural subset of `svelte/store`'s
 * `Readable`). Declared locally so the adapter never imports the Svelte
 * package; any `Readable` from `svelte/store` is assignable to/from this.
 */
export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void;
}

// ---------------------------------------------------------------------------
// toStore — expose any Signal<T> as a Svelte-compatible Readable<T>
// ---------------------------------------------------------------------------

/**
 * Adapt a {@link Signal} to the Svelte store contract. The returned store is
 * auto-subscribable with the `$` prefix in components.
 *
 * ```svelte
 * <script>
 *   const peers = toStore(room.presenceSignal);
 * </script>
 * {#each $peers as peer}{peer.id}{/each}
 * ```
 */
export function toStore<T>(signal: Signal<T>): Readable<T> {
  return {
    subscribe(run: (value: T) => void): () => void {
      return signal.subscribe(run);
    },
  };
}

/** Project a readable into a derived readable. `run` fires immediately. */
function mapStore<S, T>(
  source: Readable<S>,
  project: (value: S) => T,
): Readable<T> {
  return {
    subscribe(run: (value: T) => void): () => void {
      return source.subscribe((value) => run(project(value)));
    },
  };
}

// ---------------------------------------------------------------------------
// createRoom — own a RealtimeRoom with store-shaped presence
// ---------------------------------------------------------------------------

export interface RoomHandle<P extends PresenceState = PresenceState> {
  /** The live room. */
  room: RealtimeRoom<P>;
  /** All peers including self (self first) as a Svelte store. */
  presence: Readable<PresencePeer<P>[]>;
  /** Peers excluding self as a Svelte store. */
  others: Readable<PresencePeer<P>[]>;
  /** Tear down the room. Call from `onDestroy`. */
  destroy: () => void;
}

/**
 * Create a {@link RealtimeRoom} and expose its presence as Svelte stores.
 *
 * Unlike the React/Vue adapters, lifecycle is explicit: call the returned
 * `destroy()` from the component's `onDestroy` (Svelte has no scope-dispose
 * hook usable from a plain module).
 *
 * ```svelte
 * <script>
 *   import { onDestroy } from 'svelte';
 *   const { presence, others, room, destroy } = createRoom(() =>
 *     RealtimeRoom.join({ transport, initialPresence: { name } }),
 *   );
 *   onDestroy(destroy);
 * </script>
 * ```
 */
export function createRoom<P extends PresenceState = PresenceState>(
  create: () => RealtimeRoom<P>,
): RoomHandle<P> {
  const room = create();
  const presence = toStore(room.presenceSignal);
  const others = mapStore(presence, (peers) => peers.filter((p) => !p.self));

  return {
    room,
    presence,
    others,
    destroy: () => room.leave(),
  };
}

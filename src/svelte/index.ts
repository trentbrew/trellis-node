/**
 * Trellis Svelte — Public API Surface
 *
 * Svelte store bindings for the Trellis realtime layer. Import from
 * `trellis/svelte`:
 *
 *   import { createRoom, toStore } from 'trellis/svelte';
 *   import { RealtimeRoom, WebSocketRelayTransport } from 'trellis/svelte';
 *
 * @module trellis/svelte
 */

export { toStore, createRoom } from './stores.js';
export type { RoomHandle } from './stores.js';

// Re-exported engine + primitives for single-specifier ergonomics.
export { Signal, BatchSignal } from '../client/reactive.js';
export {
  RealtimeRoom,
  MemoryHub,
  MemoryRealtimeTransport,
  BroadcastChannelTransport,
  WebSocketRelayTransport,
} from '../realtime/index.js';
export type {
  PresencePeer,
  PresenceState,
  BroadcastEvent,
  RealtimeTransport,
} from '../realtime/types.js';

/**
 * Trellis Vue — Public API Surface
 *
 * Vue 3 composables for the Trellis realtime layer. Import from `trellis/vue`:
 *
 *   import { useRoom, useSignal } from 'trellis/vue';
 *   import { RealtimeRoom, WebSocketRelayTransport } from 'trellis/vue';
 *
 * The realtime engine and reactive primitive are re-exported here so a Vue app
 * can pull everything it needs from a single specifier.
 *
 * @module trellis/vue
 */

export { useSignal, useRoom, usePresence } from './hooks.js';
export type { RoomHandle } from './hooks.js';

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

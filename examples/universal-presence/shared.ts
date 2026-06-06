/**
 * Shared, framework-neutral wiring for the universal presence demo.
 *
 * Every framework entry (React / Vue / Svelte) joins the SAME logical room with
 * the SAME transport selection, so three tabs of three different frameworks all
 * appear in each other's cursor surface. The only per-framework code is the
 * ~20-line adapter mount — the engine, transport, and room are identical.
 */

export interface CursorPresence {
  name: string;
  color: string;
  /** Normalized 0..1 over the surface; OFFSCREEN = hidden. */
  x: number;
  y: number;
}

/** All three frameworks share this room id → they see each other. */
export const ROOM = 'universal-demo';

/** Cursor parked off-surface ("present but not pointing"). */
export const OFFSCREEN = -1;

const COLORS = ['#0f62fe', '#ee5396', '#42be65', '#ff832b', '#a56eff', '#08bdba'];

export interface Identity {
  peerId: string;
  name: string;
  color: string;
}

/** A throwaway per-tab identity tagged with the framework that created it. */
export function makeIdentity(framework: string): Identity {
  const n = Math.floor(Math.random() * 1000);
  return {
    peerId: `${framework}-${n}`,
    name: `${framework} ${n}`,
    color: COLORS[n % COLORS.length],
  };
}

/**
 * Transport selection by intent (mirrors `joinPresence`'s default):
 * no relay → BroadcastChannel (cross-tab, $0); set VITE_PRESENCE_RELAY_URL to
 * fan presence across devices through a hosted relay.
 */
export const RELAY_URL = import.meta.env.VITE_PRESENCE_RELAY_URL as
  | string
  | undefined;

/** Pointer event → normalized {x, y} over the target element. */
export function normalize(
  event: { clientX: number; clientY: number; currentTarget: EventTarget | null },
): { x: number; y: number } {
  const el = event.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  };
}

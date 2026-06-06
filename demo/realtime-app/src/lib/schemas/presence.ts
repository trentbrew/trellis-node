/** Cursor parked off the surface — "present but not pointing at anything". */
export const CURSOR_OFFSCREEN = -1;

/**
 * Per-peer presence state carried over the realtime transport. Ephemeral and
 * self-healing — never persisted to the triple-store or VCS journal. Cursor
 * x/y are normalized 0..1 over the surface; {@link CURSOR_OFFSCREEN} = hidden.
 */
export type CursorPresence = {
	name: string;
	color: string;
	x: number;
	y: number;
};

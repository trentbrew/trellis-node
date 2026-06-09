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

/** Text collab — caret is a code-point index; -1 when unfocused. */
export type TextPresence = {
	name: string;
	color: string;
	caret: number;
	/** Epoch ms of last caret move; unset = hide remote caret. */
	caretAt?: number;
};

export const CARET_STALE_MS = 2_500;

export function isRemoteCaretVisible(state: TextPresence, now = Date.now()): boolean {
	if (state.caret < 0) return false;
	const at = state.caretAt;
	if (at == null || at <= 0) return false;
	return now - at < CARET_STALE_MS;
}

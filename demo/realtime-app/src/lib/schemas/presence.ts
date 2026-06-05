import { z } from 'zod';

/** Cursor parked off the surface — "present but not pointing at anything". */
export const CURSOR_OFFSCREEN = -1;

const room = z.string().min(1).max(64);
const peerId = z.string().min(1).max(64);

/**
 * Join key for the presence live query. name/color are session-stable and only
 * change when the user edits them (committed on blur/Enter, not per keystroke),
 * so keying on them is fine — an edit is one clean leave+rejoin, and the name is
 * guaranteed set at join time (no profile-publish race).
 */
export const PresenceJoinInput = z.object({
	room,
	peerId,
	name: z.string().min(1).max(40),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex string')
});

/** High-frequency cursor update. Normalized 0..1 over the surface; -1 = hidden. */
export const PublishCursorInput = z.object({
	room,
	peerId,
	x: z.number().min(CURSOR_OFFSCREEN).max(1),
	y: z.number().min(CURSOR_OFFSCREEN).max(1)
});

/** Keep an idle (non-moving) peer alive past the TTL. */
export const HeartbeatInput = z.object({ room, peerId });

export type CursorPayload = {
	name: string;
	color: string;
	x: number;
	y: number;
};

export type PresencePeer = {
	peerId: string;
	payload: CursorPayload;
	updatedAt: number;
};

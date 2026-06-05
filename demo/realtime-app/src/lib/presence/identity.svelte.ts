import { browser } from '$app/environment';
import { generatePeerId, peerColor, peerName } from './identity';

/**
 * Per-tab identity shared across every demo. peerId/name/color live in
 * sessionStorage: stable across reloads and route navigation within a tab, but
 * distinct per tab — so two tabs read as two users (exactly what the realtime
 * demos want), while name/color stay consistent as you move between demos.
 *
 * This is identity, NOT authorization. It answers "which cursor / who posted",
 * never "who is allowed". Private rooms would layer real auth on top.
 */
const PEER_KEY = 'presence.peerId';
const NAME_KEY = 'presence.name';
const COLOR_KEY = 'presence.color';

export const COLOR_CHOICES = [
	'#0f62fe',
	'#ee5396',
	'#42be65',
	'#ff832b',
	'#a56eff',
	'#08bdba',
	'#d12771',
	'#fa4d56',
	'#4589ff',
	'#24a148'
];

function read(key: string): string | null {
	return browser ? sessionStorage.getItem(key) : null;
}

function write(key: string, value: string): void {
	if (browser) sessionStorage.setItem(key, value);
}

function initialPeerId(): string {
	const existing = read(PEER_KEY);
	if (existing) return existing;
	const id = generatePeerId();
	write(PEER_KEY, id);
	return id;
}

class IdentityState {
	readonly peerId = initialPeerId();
	name = $state(read(NAME_KEY) ?? peerName(this.peerId));
	color = $state(read(COLOR_KEY) ?? peerColor(this.peerId));

	setName(value: string): void {
		const next = value.trim() || peerName(this.peerId);
		this.name = next;
		write(NAME_KEY, next);
	}

	setColor(value: string): void {
		this.color = value;
		write(COLOR_KEY, value);
	}
}

export const identity = new IdentityState();

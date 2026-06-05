/**
 * Anonymous per-tab peer identity. This is intentionally NOT authentication:
 * it answers "which cursor is this", not "who is authorized". A random per-tab
 * id is correct here — two tabs are two cursors. Authorization (cookie/session
 * principal → room ACL) is a separate, later concern for private rooms.
 */

const ADJECTIVES = [
	'Swift',
	'Quiet',
	'Bright',
	'Calm',
	'Bold',
	'Keen',
	'Lucky',
	'Brave',
	'Sly',
	'Warm'
];

const ANIMALS = ['Otter', 'Heron', 'Fox', 'Lynx', 'Wren', 'Moth', 'Koi', 'Hare', 'Finch', 'Newt'];

/** Distinct, readable cursor colors (Carbon-ish accents). */
const PALETTE = [
	'#0f62fe',
	'#ee5396',
	'#42be65',
	'#ff832b',
	'#a56eff',
	'#08bdba',
	'#d12771',
	'#fa4d56',
	'#4589ff',
	'#bae6ff'
];

export function generatePeerId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	return `peer-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function hashSeed(seed: string): number {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	}
	return Math.abs(hash);
}

export function peerName(seed: string): string {
	const hash = hashSeed(seed);
	const adjective = ADJECTIVES[hash % ADJECTIVES.length];
	const animal = ANIMALS[Math.floor(hash / ADJECTIVES.length) % ANIMALS.length];
	return `${adjective} ${animal}`;
}

export function peerColor(seed: string): string {
	return PALETTE[hashSeed(seed) % PALETTE.length]!;
}

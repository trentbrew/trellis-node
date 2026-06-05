/**
 * Fractal Responsiveness — shell registry (wedge slice).
 *
 * A Thing has no canonical representation, only a vantage (focal depth). The
 * registry maps a continuous vantage scalar to the shell that renders it. This
 * slice intentionally omits the dual-shell crossfade and canvas scale→vantage
 * curve — vantages here are fixed integers chosen by the parent, so we resolve a
 * single shell per vantage and prove that one live kernel feeds many shells.
 */
export type ShellName = 'node' | 'row' | 'card';

export interface ShellRange {
	min: number;
	max: number;
	shell: ShellName;
}

export const SHELLS: ShellRange[] = [
	{ min: 0, max: 4, shell: 'node' },
	{ min: 5, max: 7, shell: 'row' },
	{ min: 8, max: 13, shell: 'card' }
];

export function resolveShell(vantage: number): ShellName {
	const match = SHELLS.find((range) => vantage >= range.min && vantage <= range.max);
	return match?.shell ?? 'card';
}

export const VANTAGE_LABELS: Record<number, string> = {
	2: 'labeled node',
	5: 'row',
	8: 'kanban card',
	10: 'profile card'
};

export function vantageLabel(vantage: number): string {
	return VANTAGE_LABELS[vantage] ?? `vantage ${vantage}`;
}

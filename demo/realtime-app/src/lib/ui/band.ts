/** ADR 0011 shell band — ACL wiring deferred to TRL-25. */
export type ViewerBand = 'L1' | 'L2' | 'L3';

/** Sketchpad default: editor band. */
export function getViewerBand(): ViewerBand {
	return 'L2';
}

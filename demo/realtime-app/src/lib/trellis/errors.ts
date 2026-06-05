import { error } from '@sveltejs/kit';
import { trellisConfigured } from './config';

const DEFAULT_MESSAGE =
	'Trellis sidecar not configured. Run `pnpm trellis:init` then `pnpm dev:all`.';

export function assertTrellisConfigured(message = DEFAULT_MESSAGE): void {
	if (!trellisConfigured()) {
		error(503, message);
	}
}

export async function assertTrellisAvailable(message = DEFAULT_MESSAGE): Promise<void> {
	assertTrellisConfigured(message);

	try {
		const { pingTrellis } = await import('./client');
		if (!(await pingTrellis())) {
			error(503, 'Trellis sidecar unavailable');
		}
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(503, e instanceof Error ? e.message : 'Trellis sidecar unavailable');
	}
}

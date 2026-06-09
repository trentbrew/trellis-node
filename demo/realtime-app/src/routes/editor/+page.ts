import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** Legacy block-editor URL → RealtimeText collab (doc → room). */
export const load: PageLoad = ({ url }) => {
	const doc = url.searchParams.get('doc')?.trim();
	const room = url.searchParams.get('room')?.trim() ?? doc ?? 'draft';
	const target = `/collab?room=${encodeURIComponent(room)}`;
	redirect(307, target);
};

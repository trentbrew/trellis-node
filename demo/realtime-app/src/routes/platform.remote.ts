import { query } from '$app/server';
import { assertTrellisConfigured, pingTrellis, trellisConfigured } from '$lib/trellis';
import { MAIN_LANE } from '$lib/trellis/lane';
import { tags } from '$lib/server/tags';
import { frameworks, listFrameworks } from '$lib/server/trellis';
import { getVcsLaneStatus, vcsConfigured } from '$lib/server/vcs-lane';

export const getPlatformStatus = query(async () => {
	if (!trellisConfigured()) {
		return {
			configured: false,
			trellis: false,
			mainFrameworks: 0,
			totalFrameworks: 0,
			tags: 0
		};
	}

	assertTrellisConfigured();

	const [trellis, mainFrameworks, totalFrameworks, tagCount, vcsLane] = await Promise.all([
		pingTrellis(),
		listFrameworks(MAIN_LANE).then((items) => items.length),
		frameworks.list().then((items) => items.length),
		tags.list().then((items) => items.length),
		vcsConfigured() ? getVcsLaneStatus('agent:demo' as const) : Promise.resolve(null)
	]);

	return {
		configured: true,
		trellis,
		mainFrameworks,
		totalFrameworks,
		tags: tagCount,
		mainLane: MAIN_LANE,
		vcs: vcsConfigured(),
		vcsLane
	};
});

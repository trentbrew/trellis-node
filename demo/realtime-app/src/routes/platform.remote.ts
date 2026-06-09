import { query } from '$app/server';
import { assertTrellisConfigured, pingTrellis, trellisConfigured } from '$lib/trellis';
import { getTrellis } from '$lib/trellis/client';
import { MAIN_LANE } from '$lib/trellis/lane';
import { graphRecords, listCollectionRecords } from '$lib/server/records';
import { getVcsLaneStatus, vcsConfigured } from '$lib/server/vcs-lane';

export const getPlatformStatus = query(async () => {
	if (!trellisConfigured()) {
		return {
			configured: false,
			trellis: false,
			mainRecords: 0,
			totalRecords: 0,
			collections: 0
		};
	}

	assertTrellisConfigured();

	const [trellis, mainRecords, totalRecords, collections, vcsLane] = await Promise.all([
		pingTrellis(),
		listCollectionRecords(MAIN_LANE).then((items) => items.length),
		graphRecords.list().then((items) => items.length),
		getTrellis()
			.query(`SELECT ?e WHERE { [?e "type" "CollectionMeta"] }`)
			.then((result) => result.bindings.length),
		vcsConfigured() ? getVcsLaneStatus('agent:demo' as const) : Promise.resolve(null)
	]);

	return {
		configured: true,
		trellis,
		mainRecords,
		totalRecords,
		collections,
		mainLane: MAIN_LANE,
		vcs: vcsConfigured(),
		vcsLane
	};
});

import { reconnectLiveQuery } from './live-query';
import { MAIN_LANE, normalizeLaneId, type LaneId } from './lane';

type LiveQueryFactory = (args: { lane?: string }) => { reconnect(): Promise<void> };

/** Reconnect live query instances after a mutation (single-flight). */
export async function refreshLiveQueries(
	getQuery: LiveQueryFactory,
	lanes: Array<string | LaneId>
): Promise<void> {
	const unique = [...new Set(lanes.map((lane) => normalizeLaneId(lane)))];
	await Promise.all(unique.map((lane) => reconnectLiveQuery(getQuery({ lane }))));
}

/** After a lane-scoped mutation, refresh that lane and main when needed. */
export async function refreshAfterLaneMutation(
	getQuery: LiveQueryFactory,
	lane: string | LaneId
): Promise<void> {
	const laneId = normalizeLaneId(lane);
	if (laneId === MAIN_LANE) {
		await reconnectLiveQuery(getQuery({ lane: MAIN_LANE }));
		return;
	}
	await refreshLiveQueries(getQuery, [laneId, MAIN_LANE]);
}

export async function refreshAfterEntityMutation(
	getQuery: LiveQueryFactory,
	entityLane: string | LaneId | undefined
): Promise<void> {
	await refreshAfterLaneMutation(getQuery, entityLane ?? MAIN_LANE);
}

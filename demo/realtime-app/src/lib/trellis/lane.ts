export const MAIN_LANE = 'main' as const;

export type LaneId = typeof MAIN_LANE | `agent:${string}`;

export function normalizeLaneId(lane?: string | null): LaneId {
	if (!lane || lane === MAIN_LANE) return MAIN_LANE;
	return lane.startsWith('agent:') ? (lane as LaneId) : (`agent:${lane}` as LaneId);
}

export function entityLaneId(entity: { laneId?: unknown }): LaneId {
	const lane = entity.laneId;
	if (lane == null || lane === '' || lane === MAIN_LANE) return MAIN_LANE;
	return normalizeLaneId(String(lane));
}

export function filterByLane<T extends { laneId?: unknown }>(items: T[], lane: LaneId): T[] {
	return items.filter((item) => entityLaneId(item) === lane);
}

export function isAgentLane(lane: LaneId): boolean {
	return lane !== MAIN_LANE;
}

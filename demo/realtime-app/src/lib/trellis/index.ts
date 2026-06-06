/** Server-side Trellis platform kernel — import from `$lib/trellis` in remote functions and server code. */

export {
	readTrellisConfig,
	getTrellisUrl,
	getTrellisApiKey,
	trellisConfigured,
	type TrellisDbConfig
} from './config';
export { getTrellis, pingTrellis } from './client';
export { assertTrellisConfigured, assertTrellisAvailable } from './errors';
export {
	createEntityCollection,
	type EntityCollection,
	type EntityCollectionOptions,
	type EntityMapper,
	type BindingMapper,
	type EntityMerger
} from './collection';
export {
	applyBindingDiff,
	bindingEntityId,
	hasSubscriptionChanges,
	type SubscriptionDiff
} from './diff';
export {
	MAIN_LANE,
	normalizeLaneId,
	entityLaneId,
	filterByLane,
	isAgentLane,
	type LaneId
} from './lane';
export { runLiveQueryStream, reconnectLiveQuery, type LiveQueryStreamOptions } from './live-query';
export {
	refreshLiveQueries,
	refreshAfterLaneMutation,
	refreshAfterEntityMutation
} from './platform';
export { mutateLink } from './kernel';
export { remoteFormAction, submitWithoutReset } from './forms';

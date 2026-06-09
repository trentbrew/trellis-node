import type { EntityData, Subscription } from 'trellis/client';
import { getTrellis } from './client';
import {
	applyBindingDiff,
	bindingEntityId,
	hasSubscriptionChanges,
	isHydratedEntityRow,
	type SubscriptionDiff
} from './diff';

export type EntityMapper<T> = (entity: EntityData) => T;
export type BindingMapper<T> = (row: Record<string, unknown>) => Partial<T>;
export type EntityMerger<T> = (existing: T, patch: Partial<T>) => T;

export interface EntityCollection<T extends { id: string }> {
	entityType: string;
	eqlQuery: string;
	list(): Promise<T[]>;
	create(attributes: Record<string, unknown>): Promise<string>;
	update(id: string, attributes: Record<string, unknown>): Promise<void>;
	remove(id: string): Promise<void>;
	read(id: string): Promise<T | null>;
	subscribe(onUpdate: (items: T[]) => void): Subscription;
}

export interface EntityCollectionOptions<T extends { id: string }> {
	entityType: string;
	eqlQuery: string;
	mapEntity: EntityMapper<T>;
	mapBinding?: BindingMapper<T>;
	mergeEntity?: EntityMerger<T>;
	sort?: (items: T[]) => T[];
	listLimit?: number;
}

const defaultMerge = <T extends { id: string }>(existing: T, patch: Partial<T>): T => ({
	...existing,
	...patch
});

export function createEntityCollection<T extends { id: string }>({
	entityType,
	eqlQuery,
	mapEntity,
	mapBinding,
	mergeEntity = defaultMerge,
	sort,
	listLimit = 500
}: EntityCollectionOptions<T>): EntityCollection<T> {
	const rowsToItems = (rows: Record<string, unknown>[]): T[] => {
		const items = rows.map((row) => {
			const patch = bindingMapper(row);
			const id = (patch as { id?: string }).id ?? bindingEntityId(row);
			return { id, ...patch } as T;
		});
		return sort ? sort(items) : items;
	};

	const list = async (): Promise<T[]> => rowsToItems((await getTrellis().query(eqlQuery)).bindings);

	const bindingMapper =
		mapBinding ??
		((row: Record<string, unknown>): Partial<T> => {
			const id = bindingEntityId(row);
			return { id, title: row.title } as unknown as Partial<T>;
		});

	return {
		entityType,
		eqlQuery,
		list,
		async read(id) {
			const entity = await getTrellis().read(id);
			return entity ? mapEntity(entity) : null;
		},
		create(attributes) {
			return getTrellis().create(entityType, attributes);
		},
		update(id, attributes) {
			return getTrellis().update(id, attributes);
		},
		remove(id) {
			return getTrellis().delete(id);
		},
		subscribe(onUpdate) {
			let cache: T[] | null = null;
			let refreshPromise: Promise<void> | null = null;

			const emitSorted = (items: T[]) => {
				cache = sort ? sort(items) : items;
				onUpdate(cache);
			};

			const hydrateMissing = async (items: T[]) => {
				const hydrated = await Promise.all(
					items.map(async (item) => {
						const record = item as Record<string, unknown>;
						if (isHydratedEntityRow(record)) return item;
						if (record.title != null && record.slug != null) return item;
						const full = await getTrellis().read(item.id);
						return full ? mapEntity(full) : item;
					})
				);
				emitSorted(hydrated);
			};

			return getTrellis().subscribe(eqlQuery, (result, diff) => {
				// WS pushes a full hydrated snapshot on every update — prefer it over
				// diff-patching a cache that may have been bootstrapped from sparse rows.
				if (Array.isArray(result)) {
					emitSorted(rowsToItems(result as Record<string, unknown>[]));
					return;
				}

				if (!hasSubscriptionChanges(diff as SubscriptionDiff)) return;

				if (cache === null) {
					if (!refreshPromise) {
						refreshPromise = list().then((items) => {
							emitSorted(items);
						});
					}
					return;
				}

				const patched = applyBindingDiff(
					cache,
					diff as SubscriptionDiff,
					bindingMapper,
					mergeEntity
				);

				void hydrateMissing(patched);
			});
		}
	};
}

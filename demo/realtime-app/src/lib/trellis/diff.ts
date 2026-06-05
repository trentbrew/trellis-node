export type SubscriptionDiff = {
	added: Record<string, unknown>[];
	updated: Record<string, unknown>[];
	removed: Record<string, unknown>[];
};

export function bindingEntityId(row: Record<string, unknown>): string {
	return String(row['?e'] ?? row.e ?? row.id ?? '');
}

export function hasSubscriptionChanges(diff: SubscriptionDiff): boolean {
	return diff.added.length > 0 || diff.updated.length > 0 || diff.removed.length > 0;
}

export function applyBindingDiff<T extends { id: string }>(
	cache: T[],
	diff: SubscriptionDiff,
	mapBinding: (row: Record<string, unknown>) => Partial<T>,
	merge: (existing: T, patch: Partial<T>) => T
): T[] {
	let next = [...cache];

	for (const row of diff.removed) {
		const id = bindingEntityId(row);
		if (id) next = next.filter((item) => item.id !== id);
	}

	for (const row of [...diff.added, ...diff.updated]) {
		const id = bindingEntityId(row);
		if (!id) continue;

		const patch = mapBinding(row);
		const index = next.findIndex((item) => item.id === id);

		if (index >= 0) {
			next[index] = merge(next[index]!, patch);
		} else {
			next.push({ id, ...patch } as T);
		}
	}

	return next;
}

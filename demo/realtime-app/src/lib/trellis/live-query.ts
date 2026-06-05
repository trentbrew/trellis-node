import type { Subscription } from 'trellis/client';

export interface LiveQueryStreamOptions<T> {
	bootstrap?: () => Promise<void>;
	load: () => Promise<T>;
	subscribe: (onUpdate: (value: T) => void) => Subscription;
}

/**
 * Async generator bridge for SvelteKit `query.live`.
 * Yields an initial snapshot, then pushes subscription updates.
 */
export async function* runLiveQueryStream<T>(
	options: LiveQueryStreamOptions<T>
): AsyncGenerator<T, void, void> {
	if (options.bootstrap) {
		await options.bootstrap();
	}

	yield await options.load();

	const queue: T[] = [];
	let resolveNext: ((value: T) => void) | null = null;
	let closed = false;

	const sub = options.subscribe((value) => {
		if (closed) return;
		if (resolveNext) {
			const resolve = resolveNext;
			resolveNext = null;
			resolve(value);
		} else {
			queue.push(value);
		}
	});

	try {
		while (!closed) {
			if (queue.length > 0) {
				yield queue.shift()!;
				continue;
			}

			const value = await new Promise<T>((resolve) => {
				if (closed) return;
				resolveNext = resolve;
			});

			if (closed) break;
			yield value;
		}
	} finally {
		closed = true;
		resolveNext = null;
		sub.unsubscribe();
	}
}

export async function reconnectLiveQuery(liveQuery: { reconnect(): Promise<void> }): Promise<void> {
	await liveQuery.reconnect();
}

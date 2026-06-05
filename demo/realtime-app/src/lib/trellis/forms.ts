/**
 * Remote form enhance helper for edit-in-place rows.
 * Default form enhance resets inputs after success, which reverts to stale defaults
 * before the live query re-renders.
 */
export async function submitWithoutReset(instance: { submit(): Promise<boolean> }): Promise<void> {
	await instance.submit();
}

/**
 * Encode SvelteKit remote form actions for Safari/WebKit.
 * SSR emits `?/remote=hash/name` with a literal slash; WebKit can truncate the query
 * value at `/`, so progressive enhancement never runs and native POST hits `?/remote=`.
 */
export function remoteFormAction(form: { action: string }): string {
	const prefix = '?/remote=';
	if (!form.action.startsWith(prefix)) return form.action;

	const raw = form.action.slice(prefix.length);
	let id = raw;
	try {
		id = decodeURIComponent(raw);
	} catch {
		// keep raw when already partially encoded
	}

	return `${prefix}${encodeURIComponent(id)}`;
}

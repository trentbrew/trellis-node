import { getContext, setContext } from 'svelte';
import type { EntityClass } from '$lib/registry';

export type AppSelection = {
	entityClass?: EntityClass;
	dialogShell?: string;
	id?: string;
} | null;

export type AppShellContext = {
	readonly selection: AppSelection;
	setSelection: (selection: AppSelection) => void;
	readonly insetOpen: boolean;
	toggleInset: () => void;
};

const APP_SHELL_KEY = Symbol('app-shell');

export function setAppShellContext(ctx: AppShellContext): void {
	setContext(APP_SHELL_KEY, ctx);
}

export function getAppShellContext(): AppShellContext {
	return getContext<AppShellContext>(APP_SHELL_KEY);
}

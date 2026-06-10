import type { CollectionViewMode } from '$lib/registry';
import type { ViewerBand } from '$lib/ui/band';

/**
 * Page layout variants — port of trellis-client Page.vue VARIANT_CONFIGS (subset).
 * Drives collection page chrome per ADR 0011 band × view mode.
 */
export type PageVariant = 'default' | 'browse' | 'canvas' | 'calendar' | 'grid' | 'prose';

export type VariantConfig = {
	showHeader: boolean;
	showTabs: boolean;
	showToolbar: boolean;
	contentPadding: string;
	maxWidth: string;
	fillHeight: boolean;
};

export const VARIANT_CONFIGS: Record<PageVariant, VariantConfig> = {
	canvas: {
		showHeader: false,
		showTabs: false,
		showToolbar: false,
		contentPadding: 'p-0',
		maxWidth: '',
		fillHeight: true
	},
	browse: {
		showHeader: true,
		showTabs: false,
		showToolbar: true,
		contentPadding: 'px-6 py-4 pt-0',
		maxWidth: 'max-w-4xl mx-auto w-full',
		fillHeight: false
	},
	calendar: {
		showHeader: false,
		showTabs: false,
		showToolbar: false,
		contentPadding: 'p-0',
		maxWidth: '',
		fillHeight: true
	},
	grid: {
		showHeader: false,
		showTabs: false,
		showToolbar: false,
		contentPadding: 'p-0',
		maxWidth: '',
		fillHeight: true
	},
	prose: {
		showHeader: true,
		showTabs: false,
		showToolbar: false,
		contentPadding: 'px-6 pb-6',
		maxWidth: 'max-w-3xl mx-auto w-full',
		fillHeight: false
	},
	default: {
		showHeader: true,
		showTabs: false,
		showToolbar: false,
		contentPadding: 'px-6 py-6',
		maxWidth: 'max-w-3xl mx-auto w-full',
		fillHeight: false
	}
};

export function variantConfig(variant: PageVariant): VariantConfig {
	return VARIANT_CONFIGS[variant];
}

export function resolveCollectionPageVariant(
	viewMode: CollectionViewMode,
	band: ViewerBand = 'L2'
): PageVariant {
	if (viewMode === 'calendar' || viewMode === 'gantt') return 'calendar';
	if (viewMode === 'card-grid') return 'grid';
	if (band === 'L1') return 'prose';
	return 'browse';
}

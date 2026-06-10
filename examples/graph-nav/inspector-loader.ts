/**
 * L3 operator inset — Trellis DB inspector (Vue CE) as a floating FAB.
 * Loads same-origin via Vite proxy (`/__trellis/inspector.js` → trellis :8230).
 *
 * Enable in prod builds with VITE_TRELLIS_INSPECTOR=true.
 */
const enabled =
	import.meta.env.DEV || import.meta.env.VITE_TRELLIS_INSPECTOR === 'true';

export function loadTrellisInspector(): void {
	if (!enabled) return;
	if (document.querySelector('script[data-trellis-inspector]')) return;

	const script = document.createElement('script');
	script.src = '/__trellis/inspector.js';
	script.defer = true;
	script.dataset.trellisInspector = '';
	script.dataset.clientUrl = window.location.origin;
	document.body.appendChild(script);
}

loadTrellisInspector();

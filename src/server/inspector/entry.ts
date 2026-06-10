/**
 * Trellis DB Inspector — browser entry point.
 *
 * Defines a `<trellis-db-inspector>` custom element (Web Component)
 * and auto-appends it to <body> when the script loads.
 *
 * The `db-url` attribute is derived automatically from the script's src origin,
 * so no manual configuration is required in the host app.
 */
import { defineCustomElement } from 'vue';
import Inspector from './Inspector.vue';

const TrellisDbInspector = defineCustomElement(Inspector);

if (!customElements.get('trellis-db-inspector')) {
  customElements.define('trellis-db-inspector', TrellisDbInspector);
}

function detectDbUrl(): string {
  // currentScript is set synchronously while this script is being evaluated
  const cs = document.currentScript as HTMLScriptElement | null;
  if (cs?.src) return new URL(cs.src).origin;
  // Fallback: scan existing scripts for the inspector path
  for (const s of Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))) {
    if (s.src.includes('/__trellis/inspector')) return new URL(s.src).origin;
  }
  return window.location.origin;
}

function autoInject() {
  if (document.querySelector('trellis-db-inspector')) return;
  const el = document.createElement('trellis-db-inspector');
  const script = document.currentScript as HTMLScriptElement | null;
  el.setAttribute('db-url', detectDbUrl());
  const clientUrl = script?.dataset?.clientUrl ?? window.location.origin;
  if (clientUrl) el.setAttribute('client-url', clientUrl);
  document.body.appendChild(el);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInject);
} else {
  autoInject();
}

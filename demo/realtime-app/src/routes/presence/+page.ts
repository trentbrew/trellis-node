// Presence is client-only: SSR would make the server join the room as a phantom
// peer, and the random per-tab peer id guarantees a hydration mismatch. Rendering
// client-side lets us create a stable identity eagerly so the live query is never
// null.
export const ssr = false;

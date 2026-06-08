/**
 * Shared, framework-neutral wiring for the universal realtime demos.
 *
 * Presence, chat, and text each use their own logical room id but the same
 * transport selection (`joinPresence` + optional relay). Framework entries only
 * differ in the ~30-line adapter mount.
 */

/** Minimal presence payload shared across demos (name + color). */
export interface DemoPresence {
  name: string;
  color: string;
}

export interface CursorPresence extends DemoPresence {
  /** Normalized 0..1 over the surface; OFFSCREEN = hidden / out of frame. */
  x: number;
  y: number;
}

/** Text demo presence — caret is a code-point index; -1 when unfocused. */
export interface TextPresence extends DemoPresence {
  caret: number;
  /** Epoch ms of last intentional caret move; unset/0 = don't render remote caret. */
  caretAt?: number;
}

/** Hide remote carets after this long without a move (focus alone doesn't refresh). */
export const CARET_STALE_MS = 2_500;

export function isRemoteCaretVisible(
  state: TextPresence,
  now = Date.now(),
): boolean {
  if (state.caret < 0) return false;
  const at = state.caretAt;
  if (at == null || at <= 0) return false;
  return now - at < CARET_STALE_MS;
}

/** Grow-only chat message body. */
export interface ChatPayload {
  text: string;
}

/** Per-demo room ids — peers in the same demo + room see each other. */
export const PRESENCE_ROOM = 'universal-demo';
export const CHAT_ROOM = 'universal-chat';
export const TEXT_ROOM = 'universal-text';

/** @deprecated Use PRESENCE_ROOM */
export const ROOM = PRESENCE_ROOM;

/** Cursor parked off-surface ("present but not pointing"). */
export const OFFSCREEN = -1;

const COLORS = ['#0f62fe', '#ee5396', '#42be65', '#ff832b', '#a56eff', '#08bdba'];

export interface Identity {
  peerId: string;
  name: string;
  color: string;
}

/** Best-effort browser label for demo peer names (sync; Brave may read as Chrome). */
export function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Web';
}

/**
 * Per-tab identity: framework + browser + random suffix.
 * e.g. "React · Chrome 397" — helps QA cross-browser sessions.
 */
export function makeIdentity(framework: string): Identity {
  const n = Math.floor(Math.random() * 1000);
  const browser = detectBrowser();
  const slug = framework.toLowerCase().replace(/\s+/g, '-');
  return {
    peerId: `${slug}-${browser.toLowerCase()}-${n}`,
    name: `${framework} · ${browser} ${n}`,
    color: COLORS[n % COLORS.length],
  };
}

/**
 * Transport selection by intent (mirrors `joinPresence`'s default):
 * no relay → BroadcastChannel (cross-tab, $0); set VITE_PRESENCE_RELAY_URL to
 * fan presence across devices through a hosted relay.
 */
export const RELAY_URL = import.meta.env.VITE_PRESENCE_RELAY_URL as
  | string
  | undefined;

/** Pointer event → normalized {x, y} over the target element. */
export function normalize(
  event: { clientX: number; clientY: number; currentTarget: EventTarget | null },
): { x: number; y: number } {
  const el = event.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  };
}

/** localStorage key scoped by demo + room + transport tier. */
export function storageKey(demo: string, room: string): string {
  const tier = RELAY_URL ?? 'local';
  return `trellis:${demo}:${room}:${tier}`;
}

export {
  textDiff,
  codePointLen,
  utf16ToCodePointIndex,
  measureCaret,
  applyRemoteTextareaValue,
  scheduleCaretSync,
  cancelCaretSync,
  hideTextCaret,
  syncTextCaretPresence,
  isTextEditorActive,
  bindTextCaretWindowHide,
} from './shared/text.js';

/** Header label for connected peers (includes self). */
export function formatOnline(count: number): string {
  return `${count} online`;
}
export { createTypingTracker, formatTyping, type TypingPeer } from './shared/typing.js';

export const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

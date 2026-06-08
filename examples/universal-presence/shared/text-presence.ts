/**
 * Caret presence sync for the text demo — hide immediately on unfocus,
 * cancel pending rAF syncs so a stale caret can't republish after blur.
 */

import { utf16ToCodePointIndex } from './text.js';

export interface CaretPresenceRoom {
  setPresence(partial: { caret?: number; caretAt?: number }): void;
}

/** True when this textarea is the active, focused editor (not a background tab). */
export function isTextEditorActive(textarea: HTMLTextAreaElement): boolean {
  return (
    document.visibilityState === 'visible' &&
    document.hasFocus() &&
    document.activeElement === textarea
  );
}

let caretSyncGen = 0;

/** Defer caret sync until after the browser commits selection (Edge-safe). */
export function scheduleCaretSync(fn: () => void): void {
  const gen = ++caretSyncGen;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (gen !== caretSyncGen) return;
      fn();
    }),
  );
}

/** Drop any in-flight deferred caret sync (call before hiding). */
export function cancelCaretSync(): void {
  caretSyncGen += 1;
}

export function clearTextCaretPresence(room: CaretPresenceRoom): void {
  room.setPresence({ caret: -1, caretAt: 0 });
}

/** Hide local caret in presence — immediate, no deferred republish. */
export function hideTextCaret(room: CaretPresenceRoom): void {
  cancelCaretSync();
  clearTextCaretPresence(room);
}

export function syncTextCaretPresence(
  room: CaretPresenceRoom,
  textarea: HTMLTextAreaElement,
): void {
  if (!isTextEditorActive(textarea)) {
    clearTextCaretPresence(room);
    return;
  }
  const caret = utf16ToCodePointIndex(textarea.value, textarea.selectionStart);
  room.setPresence({ caret, caretAt: Date.now() });
}

/** Hide when the tab/window loses focus (textarea blur alone can lag). */
export function bindTextCaretWindowHide(
  room: CaretPresenceRoom,
  getTextarea: () => HTMLTextAreaElement | null = () => null,
): () => void {
  const hide = () => hideTextCaret(room);
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') hide();
  };
  const onPageHide = () => hide();
  // Catch background tabs where activeElement stays on the textarea.
  const tick = setInterval(() => {
    const ta = getTextarea();
    if (ta && document.activeElement === ta && !isTextEditorActive(ta)) {
      hide();
    }
  }, 400);
  window.addEventListener('blur', hide);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    clearInterval(tick);
    window.removeEventListener('blur', hide);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
  };
}

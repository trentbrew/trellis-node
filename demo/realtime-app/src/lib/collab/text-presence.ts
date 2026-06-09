/**
 * Caret presence sync for RealtimeText — hide on blur, defer rAF sync.
 */

import { utf16ToCodePointIndex } from './text.js';

export interface CaretPresenceRoom {
	setPresence(partial: { caret?: number; caretAt?: number }): void;
}

export function isTextEditorActive(textarea: HTMLTextAreaElement): boolean {
	return (
		document.visibilityState === 'visible' &&
		document.hasFocus() &&
		document.activeElement === textarea
	);
}

let caretSyncGen = 0;

export function scheduleCaretSync(fn: () => void): void {
	const gen = ++caretSyncGen;
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			if (gen !== caretSyncGen) return;
			fn();
		})
	);
}

export function cancelCaretSync(): void {
	caretSyncGen += 1;
}

export function clearTextCaretPresence(room: CaretPresenceRoom): void {
	room.setPresence({ caret: -1, caretAt: 0 });
}

export function hideTextCaret(room: CaretPresenceRoom): void {
	cancelCaretSync();
	clearTextCaretPresence(room);
}

export function syncTextCaretPresence(
	room: CaretPresenceRoom,
	textarea: HTMLTextAreaElement
): void {
	if (!isTextEditorActive(textarea)) {
		clearTextCaretPresence(room);
		return;
	}
	const caret = utf16ToCodePointIndex(textarea.value, textarea.selectionStart);
	room.setPresence({ caret, caretAt: Date.now() });
}

export function bindTextCaretWindowHide(
	room: CaretPresenceRoom,
	getTextarea: () => HTMLTextAreaElement | null = () => null
): () => void {
	const hide = () => hideTextCaret(room);
	const onVisibility = () => {
		if (document.visibilityState === 'hidden') hide();
	};
	const tick = setInterval(() => {
		const ta = getTextarea();
		if (ta && document.activeElement === ta && !isTextEditorActive(ta)) {
			hide();
		}
	}, 400);
	window.addEventListener('blur', hide);
	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('pagehide', hide);
	return () => {
		clearInterval(tick);
		window.removeEventListener('blur', hide);
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('pagehide', hide);
	};
}

/**
 * RealtimeText textarea helpers — code-point aware (matches CRDT indices).
 */

export {
	applyRemoteTextareaValue,
	codePointLen,
	codePointToUtf16Offset,
	measureCaret,
	textDiff,
	utf16ToCodePointIndex
} from './text-core.js';

export {
	scheduleCaretSync,
	cancelCaretSync,
	clearTextCaretPresence,
	hideTextCaret,
	syncTextCaretPresence,
	isTextEditorActive,
	bindTextCaretWindowHide,
	type CaretPresenceRoom
} from './text-presence.js';

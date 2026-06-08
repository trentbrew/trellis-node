/**
 * Text-editor helpers — code-point aware to match RealtimeText visible indices.
 *
 * JavaScript string indices are UTF-16 code units; emoji and other astral
 * characters are two units wide. RealtimeText iterates with `for (const ch of
 * str)` (code points), so diffs and caret positions must use the same basis.
 */

/** Visible character count — matches RealtimeText indices. */
export function codePointLen(str: string): number {
  return [...str].length;
}

/** Map a textarea UTF-16 caret offset to a RealtimeText index. */
export function utf16ToCodePointIndex(str: string, utf16Offset: number): number {
  return [...str.slice(0, utf16Offset)].length;
}

/** Map a RealtimeText index back to a UTF-16 offset for selection APIs. */
export function codePointToUtf16Offset(str: string, cpIndex: number): number {
  let cp = 0;
  let utf16 = 0;
  for (const ch of str) {
    if (cp === cpIndex) return utf16;
    utf16 += ch.length;
    cp += 1;
  }
  return utf16;
}

/**
 * Diff two strings on code-point indices — safe for emoji and combining marks
 * at the code-point level (not full grapheme clusters, but fixes the astral bug).
 */
export function textDiff(
  oldStr: string,
  newStr: string,
): { index: number; removed: number; inserted: string } {
  const old = [...oldStr];
  const neu = [...newStr];
  let start = 0;
  const min = Math.min(old.length, neu.length);
  while (start < min && old[start] === neu[start]) start++;
  let endOld = old.length;
  let endNew = neu.length;
  while (
    endOld > start &&
    endNew > start &&
    old[endOld - 1] === neu[endNew - 1]
  ) {
    endOld--;
    endNew--;
  }
  return {
    index: start,
    removed: endOld - start,
    inserted: neu.slice(start, endNew).join(''),
  };
}

/**
 * Measure caret pixel offset inside a textarea (mirror-div technique).
 * Returns position relative to the textarea's padding box.
 */
export function measureCaret(
  textarea: HTMLTextAreaElement,
  codePointIndex: number,
): { top: number; left: number } | null {
  if (codePointIndex < 0) return null;
  const text = textarea.value;
  const cpLen = codePointLen(text);
  if (codePointIndex > cpLen) return null;

  const mirror = document.createElement('div');
  const cs = getComputedStyle(textarea);
  const props = [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'textTransform',
    'wordSpacing',
    'textIndent',
    'whiteSpace',
    'wordWrap',
    'overflowWrap',
    'lineHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'boxSizing',
  ] as const;
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflow = 'hidden';
  mirror.style.width = `${textarea.clientWidth}px`;
  for (const prop of props) {
    mirror.style[prop] = cs[prop];
  }

  const utf16 = codePointToUtf16Offset(text, codePointIndex);
  const before = text.slice(0, utf16);
  const after = text.slice(utf16);

  // Mirror: text-before + zero-width marker + text-after for correct line wrap.
  mirror.textContent = '';
  mirror.append(before);
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.append(marker);
  if (after.length > 0) mirror.append(after);

  document.body.appendChild(mirror);
  const top = marker.offsetTop - textarea.scrollTop;
  const left = marker.offsetLeft - textarea.scrollLeft;
  document.body.removeChild(mirror);

  return { top, left };
}

export {
  scheduleCaretSync,
  cancelCaretSync,
  clearTextCaretPresence,
  hideTextCaret,
  syncTextCaretPresence,
  isTextEditorActive,
  bindTextCaretWindowHide,
  type CaretPresenceRoom,
} from './text-presence.js';

/** Apply a remote CRDT value to a textarea while preserving caret when possible. */
export function applyRemoteTextareaValue(
  textarea: HTMLTextAreaElement,
  next: string,
  last: string,
): void {
  const current = textarea.value;
  if (next === current) return;

  const sel = textarea.selectionStart;
  const selEnd = textarea.selectionEnd;
  // Selection offsets are relative to the live DOM value, not our tracked last.
  const cpCaret = utf16ToCodePointIndex(current, sel);
  const cpEnd = utf16ToCodePointIndex(current, selEnd);

  textarea.value = next;

  const d = textDiff(last, next);
  let newCp = cpCaret;
  if (cpCaret >= d.index) {
    if (cpCaret < d.index + d.removed) {
      newCp = d.index + codePointLen(d.inserted);
    } else {
      newCp = cpCaret - d.removed + codePointLen(d.inserted);
    }
  }
  let newCpEnd = cpEnd;
  if (cpEnd >= d.index) {
    if (cpEnd < d.index + d.removed) {
      newCpEnd = d.index + codePointLen(d.inserted);
    } else {
      newCpEnd = cpEnd - d.removed + codePointLen(d.inserted);
    }
  }

  const start = codePointToUtf16Offset(next, newCp);
  const end = codePointToUtf16Offset(next, newCpEnd);
  try {
    textarea.setSelectionRange(start, end);
  } catch {
    /* ignore */
  }
}

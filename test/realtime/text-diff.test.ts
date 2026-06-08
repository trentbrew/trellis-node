import { describe, test, expect } from 'vitest';
import { textDiff, codePointLen } from '../../examples/universal-presence/shared/text.js';
import {
  isRemoteCaretVisible,
  CARET_STALE_MS,
  type TextPresence,
} from '../../examples/universal-presence/shared.js';

const base: TextPresence = { name: 'A', color: '#f00', caret: 0 };

describe('textDiff (code-point aware)', () => {
  test('append ascii at end', () => {
    const d = textDiff('hello', 'hello!');
    expect(d).toEqual({ index: 5, removed: 0, inserted: '!' });
  });

  test('append emoji without corrupting index', () => {
    const d = textDiff('hi', 'hi🧐');
    expect(d.index).toBe(2);
    expect(d.removed).toBe(0);
    expect(d.inserted).toBe('🧐');
    expect(codePointLen('hi🧐')).toBe(3);
  });

  test('insert in middle with emoji before cursor', () => {
    const d = textDiff('a🧐c', 'a🧐bc');
    expect(d.index).toBe(2);
    expect(d.inserted).toBe('b');
  });

  test('delete emoji', () => {
    const d = textDiff('hi🧐', 'hi');
    expect(d.index).toBe(2);
    expect(d.removed).toBe(1);
    expect(d.inserted).toBe('');
  });
});

describe('isRemoteCaretVisible', () => {
  test('hides unfocused and stale carets', () => {
    const now = 1_000_000;
    expect(isRemoteCaretVisible({ ...base, caret: -1 }, now)).toBe(false);
    expect(isRemoteCaretVisible({ ...base, caret: 0 }, now)).toBe(false);
    expect(
      isRemoteCaretVisible(
        { ...base, caret: 0, caretAt: now - CARET_STALE_MS - 1 },
        now,
      ),
    ).toBe(false);
    expect(
      isRemoteCaretVisible({ ...base, caret: 3, caretAt: now - 1000 }, now),
    ).toBe(true);
  });
});

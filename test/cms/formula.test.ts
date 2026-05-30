import { describe, expect, test } from 'vitest';
import {
  applyFormulas,
  evaluateFormula,
  parseFields,
} from '../../src/cms/formula.js';
import type { Entry } from '../../src/cms/types.js';

describe('evaluateFormula', () => {
  test('evaluates numeric fields and arithmetic precedence', () => {
    expect(evaluateFormula('{price} * {quantity} + 2', { price: 10, quantity: '3' })).toBe(32);
  });

  test('supports parentheses and unary operators', () => {
    expect(evaluateFormula('-({a} + {b}) / 2', { a: 4, b: 6 })).toBe(-5);
  });

  test('returns undefined for missing or unsafe expressions', () => {
    expect(evaluateFormula('{missing} + 1', {})).toBeUndefined();
    expect(evaluateFormula('process.exit()', {})).toBeUndefined();
    expect(evaluateFormula('1 / 0', {})).toBeUndefined();
  });
});

describe('parseFields', () => {
  test('parses persisted schema props', () => {
    expect(parseFields('[{"key":"total","type":"formula","formula":"{a}+{b}"}]')).toEqual([
      { key: 'total', type: 'formula', formula: '{a}+{b}' },
    ]);
  });

  test('returns an empty array for invalid schema props', () => {
    expect(parseFields('not json')).toEqual([]);
    expect(parseFields('{"key":"x"}')).toEqual([]);
  });
});

describe('applyFormulas', () => {
  test('adds virtual fields without mutating the entry', () => {
    const entry: Entry = {
      id: 'line:1',
      type: 'LineItem',
      status: 'published',
      fields: { price: 12, quantity: 2 },
    };
    const next = applyFormulas(entry, [
      { key: 'total', type: 'formula', formula: '{price} * {quantity}' },
    ]);
    expect(next.fields.total).toBe(24);
    expect(entry.fields.total).toBeUndefined();
  });

  test('allows formula fields to depend on other formulas', () => {
    const entry: Entry = {
      id: 'line:1',
      type: 'LineItem',
      status: 'published',
      fields: { price: 10, quantity: 2 },
    };
    const next = applyFormulas(entry, [
      { key: 'grand', type: 'formula', formula: '{subtotal} + 5' },
      { key: 'subtotal', type: 'formula', formula: '{price} * {quantity}' },
    ]);
    expect(next.fields.subtotal).toBe(20);
    expect(next.fields.grand).toBe(25);
  });
});

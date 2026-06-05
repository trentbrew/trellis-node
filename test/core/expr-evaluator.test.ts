import { describe, expect, test } from 'vitest';
import {
  ExprEvaluator,
  evalExpr,
} from '../../src/core/computation/expr-evaluator.js';

describe('ExprEvaluator', () => {
  test('evaluates field references', () => {
    const ev = new ExprEvaluator();
    expect(ev.eval('$price', { price: 10 })).toBe(10);
  });

  test('evaluates $if', () => {
    const ev = new ExprEvaluator();
    expect(ev.eval('$if($gt($score, 10), "high", "low")', { score: 12 })).toBe(
      'high',
    );
  });

  test('evaluates $concat', () => {
    const ev = new ExprEvaluator();
    expect(ev.eval('$concat("a", $suffix)', { suffix: 'b' })).toBe('ab');
  });

  test('evaluates $add', () => {
    const ev = new ExprEvaluator();
    expect(ev.eval('$add($price, $quantity)', { price: 10, quantity: 3 })).toBe(
      13,
    );
  });

  test('evalExpr returns atoms for bindings', () => {
    expect(
      evalExpr('$mul($price, $quantity)', { price: 10, quantity: 3 }),
    ).toBe(30);
  });
});

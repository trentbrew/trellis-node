/**
 * TRL-7 — typed where filters for entitiesQuery.
 */
import { describe, expect, test } from 'vitest';
import { parseSimple } from '../../src/core/query/parser.js';
import {
  entitiesQuery,
  entityQuery,
  formatEqlLiteral,
  whereCondition,
} from '../../src/schema/eql.js';

describe('formatEqlLiteral', () => {
  test('formats strings, numbers, and booleans', () => {
    expect(formatEqlLiteral('hi')).toBe('"hi"');
    expect(formatEqlLiteral('say "yo"')).toBe('"say \\"yo\\""');
    expect(formatEqlLiteral(42)).toBe('42');
    expect(formatEqlLiteral(3.5)).toBe('3.5');
    expect(formatEqlLiteral(true)).toBe('true');
    expect(formatEqlLiteral(false)).toBe('false');
  });
});

describe('whereCondition', () => {
  test('equality shorthand', () => {
    expect(whereCondition('pinned', true)).toBe('pinned = true');
    expect(whereCondition('order', 3)).toBe('order = 3');
    expect(whereCondition('label', 'Home')).toBe('label = "Home"');
  });

  test('structured operators', () => {
    expect(whereCondition('order', { gte: 5 })).toBe('order >= 5');
    expect(whereCondition('order', { lt: 10 })).toBe('order < 10');
    expect(whereCondition('title', { contains: 'bug' })).toBe(
      'title contains "bug"',
    );
    expect(whereCondition('status', { ne: 'archived' })).toBe(
      'status != "archived"',
    );
  });
});

describe('entitiesQuery', () => {
  test('type-only query', () => {
    expect(entitiesQuery('Note')).toBe('find ?e where type = "Note"');
  });

  test('boolean equality is not stringified', () => {
    const eql = entitiesQuery('Note', { pinned: true });
    expect(eql).toBe('find ?e where type = "Note" and pinned = true');
    expect(parseSimple(eql).where).toHaveLength(2);
  });

  test('numeric comparisons emit operator syntax', () => {
    const eql = entitiesQuery('Task', { priority: { gte: 2 } });
    expect(eql).toBe('find ?e where type = "Task" and priority >= 2');
  });

  test('combines multiple AND conditions', () => {
    const eql = entitiesQuery('NavItem', {
      section: 'navsection:a',
      order: { lte: 5 },
    });
    expect(eql).toBe(
      'find ?e where type = "NavItem" and section = "navsection:a" and order <= 5',
    );
  });

  test('entityQuery filters to one id (TRL-9)', () => {
    const eql = entityQuery('Note', 'note:abc');
    expect(eql).toContain('FILTER ?e = "note:abc"');
    expect(parseSimple(eql).filters).toHaveLength(1);
  });
});

/**
 * Entity projection — sparse bindings ↔ plain records.
 */
import { describe, expect, test } from 'vitest';
import {
  bindingEntityId,
  bindingToEntity,
  entityRecordToPlain,
  hydrateBindings,
  isSparseBinding,
} from '../../src/schema/entity-projection.js';

describe('entity-projection', () => {
  test('detects sparse vs hydrated bindings', () => {
    expect(isSparseBinding({ e: 'navsection:a' })).toBe(true);
    expect(
      isSparseBinding({
        id: 'navsection:a',
        type: 'NavSection',
        label: 'Workspace',
      }),
    ).toBe(false);
  });

  test('bindingEntityId accepts e, id, or ?e', () => {
    expect(bindingEntityId({ e: 'x' })).toBe('x');
    expect(bindingEntityId({ id: 'y' })).toBe('y');
    expect(bindingEntityId({ '?e': 'z' })).toBe('z');
  });

  test('entityRecordToPlain strips type fact into top-level type', () => {
    const plain = entityRecordToPlain({
      id: 'navitem:1',
      type: 'NavItem',
      facts: [
        { a: 'type', v: 'NavItem' },
        { a: 'label', v: 'Home' },
        { a: 'order', v: 0 },
      ],
    });
    expect(plain).toEqual({
      id: 'navitem:1',
      type: 'NavItem',
      label: 'Home',
      order: 0,
    });
  });

  test('hydrateBindings loads sparse rows from kernel', () => {
    const kernel = {
      getEntity: (id: string) =>
        id === 'a'
          ? {
              id: 'a',
              type: 'NavSection',
              facts: [{ a: 'label', v: 'Loaded' }],
            }
          : null,
    };

    const out = hydrateBindings(kernel, [{ e: 'a' }, { id: 'b', type: 'X' }]);
    expect(out[0]).toEqual({ id: 'a', type: 'NavSection', label: 'Loaded' });
    expect(bindingToEntity(out[1]!)).toEqual({ id: 'b', type: 'X' });
  });
});

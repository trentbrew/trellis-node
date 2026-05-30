import { describe, test, expect } from 'vitest';
import {
  patchesCommute,
  semanticMerge,
} from '../../src/semantic/semantic-merge.js';
import type { SemanticPatch, ASTEntity } from '../../src/semantic/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(name: string, kind: string = 'FunctionDef'): ASTEntity {
  return {
    id: `${kind}:test.ts:${name}`,
    kind: kind as any,
    name,
    scopePath: name,
    span: [0, 100],
    rawText: `function ${name}() {}`,
    signature: `function ${name}() {}`,
    children: [],
  };
}

// ---------------------------------------------------------------------------
// Commutativity
// ---------------------------------------------------------------------------

describe('patchesCommute', () => {
  test('disjoint entities commute', () => {
    const a: SemanticPatch = { kind: 'symbolModify', entityId: 'f1', entityName: 'f1', oldSignature: 'a', newSignature: 'b', oldRawText: '', newRawText: '' };
    const b: SemanticPatch = { kind: 'symbolModify', entityId: 'f2', entityName: 'f2', oldSignature: 'c', newSignature: 'd', oldRawText: '', newRawText: '' };
    expect(patchesCommute(a, b)).toBe(true);
  });

  test('same entity modify-modify does NOT commute', () => {
    const a: SemanticPatch = { kind: 'symbolModify', entityId: 'f1', entityName: 'f1', oldSignature: 'a', newSignature: 'b', oldRawText: '', newRawText: '' };
    const b: SemanticPatch = { kind: 'symbolModify', entityId: 'f1', entityName: 'f1', oldSignature: 'a', newSignature: 'c', oldRawText: '', newRawText: '' };
    expect(patchesCommute(a, b)).toBe(false);
  });

  test('identical patches commute (idempotent)', () => {
    const a: SemanticPatch = { kind: 'symbolModify', entityId: 'f1', entityName: 'f1', oldSignature: 'a', newSignature: 'b', oldRawText: '', newRawText: '' };
    expect(patchesCommute(a, a)).toBe(true);
  });

  test('importAdd + importAdd on same source commutes', () => {
    const a: SemanticPatch = { kind: 'importAdd', fileId: 'f', source: 'mod', specifiers: ['a'], rawText: '' };
    const b: SemanticPatch = { kind: 'importAdd', fileId: 'f', source: 'mod', specifiers: ['b'], rawText: '' };
    expect(patchesCommute(a, b)).toBe(true);
  });

  test('symbolMove + symbolModify commutes', () => {
    const a: SemanticPatch = { kind: 'symbolMove', entityId: 'f1', entityName: 'f1', oldFile: 'a.ts', newFile: 'b.ts' };
    const b: SemanticPatch = { kind: 'symbolModify', entityId: 'f1', entityName: 'f1', oldSignature: 'a', newSignature: 'b', oldRawText: '', newRawText: '' };
    expect(patchesCommute(a, b)).toBe(true);
  });

  test('symbolRemove + symbolModify does NOT commute', () => {
    const a: SemanticPatch = { kind: 'symbolRemove', entityId: 'f1', entityName: 'f1' };
    const b: SemanticPatch = { kind: 'symbolModify', entityId: 'f1', entityName: 'f1', oldSignature: 'a', newSignature: 'b', oldRawText: '', newRawText: '' };
    expect(patchesCommute(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Semantic merge
// ---------------------------------------------------------------------------

describe('semanticMerge', () => {
  test('disjoint patches merge cleanly', () => {
    const ours: SemanticPatch[] = [
      { kind: 'symbolAdd', entity: makeEntity('foo') },
    ];
    const theirs: SemanticPatch[] = [
      { kind: 'symbolAdd', entity: makeEntity('bar') },
    ];

    const result = semanticMerge(ours, theirs, 'test.ts');
    expect(result.clean).toBe(true);
    expect(result.patches.length).toBe(2);
    expect(result.conflicts.length).toBe(0);
  });

  test('conflicting modify-modify produces conflict', () => {
    const ours: SemanticPatch[] = [
      { kind: 'symbolModify', entityId: 'f1', entityName: 'f', oldSignature: 'a', newSignature: 'ours', oldRawText: '', newRawText: '' },
    ];
    const theirs: SemanticPatch[] = [
      { kind: 'symbolModify', entityId: 'f1', entityName: 'f', oldSignature: 'a', newSignature: 'theirs', oldRawText: '', newRawText: '' },
    ];

    const result = semanticMerge(ours, theirs, 'test.ts');
    expect(result.clean).toBe(false);
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].entityName).toBe('f');
  });

  test('remove + modify produces conflict', () => {
    const ours: SemanticPatch[] = [
      { kind: 'symbolRemove', entityId: 'f1', entityName: 'f' },
    ];
    const theirs: SemanticPatch[] = [
      { kind: 'symbolModify', entityId: 'f1', entityName: 'f', oldSignature: 'a', newSignature: 'b', oldRawText: '', newRawText: '' },
    ];

    const result = semanticMerge(ours, theirs, 'test.ts');
    expect(result.clean).toBe(false);
    expect(result.conflicts.length).toBe(1);
  });

  test('only ours patches — all applied', () => {
    const ours: SemanticPatch[] = [
      { kind: 'symbolAdd', entity: makeEntity('foo') },
      { kind: 'symbolAdd', entity: makeEntity('bar') },
    ];

    const result = semanticMerge(ours, [], 'test.ts');
    expect(result.clean).toBe(true);
    expect(result.patches.length).toBe(2);
  });

  test('only theirs patches — all applied', () => {
    const theirs: SemanticPatch[] = [
      { kind: 'symbolAdd', entity: makeEntity('baz') },
    ];

    const result = semanticMerge([], theirs, 'test.ts');
    expect(result.clean).toBe(true);
    expect(result.patches.length).toBe(1);
  });

  test('identical patches are deduplicated', () => {
    const patch: SemanticPatch = { kind: 'symbolAdd', entity: makeEntity('foo') };

    const result = semanticMerge([patch], [patch], 'test.ts');
    expect(result.clean).toBe(true);
    // Identical patches on the same entity commute; should have just 1
    expect(result.patches.length).toBe(1);
  });

  test('rename + modify produces conflict with combine suggestion', () => {
    const ours: SemanticPatch[] = [
      { kind: 'symbolRename', entityId: 'f1', oldName: 'old', newName: 'new' },
    ];
    const theirs: SemanticPatch[] = [
      { kind: 'symbolModify', entityId: 'f1', entityName: 'old', oldSignature: 'a', newSignature: 'b', oldRawText: '', newRawText: '' },
    ];

    const result = semanticMerge(ours, theirs, 'test.ts');
    expect(result.clean).toBe(false);
    expect(result.conflicts[0].suggestion).toBe('combine');
  });

  test('empty patches produce clean merge', () => {
    const result = semanticMerge([], [], 'test.ts');
    expect(result.clean).toBe(true);
    expect(result.patches.length).toBe(0);
  });
});

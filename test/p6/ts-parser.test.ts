import { describe, test, expect } from 'vitest';
import { typescriptParser } from '../../src/semantic/ts-parser.js';

// ---------------------------------------------------------------------------
// Parsing declarations
// ---------------------------------------------------------------------------

describe('typescriptParser.parse — declarations', () => {
  test('extracts function declarations', () => {
    const result = typescriptParser.parse(
      `function greet(name: string): string {\n  return "hello " + name;\n}`,
      'test.ts',
    );
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].kind).toBe('FunctionDef');
    expect(result.declarations[0].name).toBe('greet');
  });

  test('extracts exported function', () => {
    const result = typescriptParser.parse(
      `export function add(a: number, b: number): number {\n  return a + b;\n}`,
      'test.ts',
    );
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('add');
  });

  test('extracts class declarations with members', () => {
    const result = typescriptParser.parse(
      `class Dog {\n  name: string;\n  constructor(name: string) {\n    this.name = name;\n  }\n  bark(): string {\n    return "woof";\n  }\n}`,
      'test.ts',
    );
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].kind).toBe('ClassDef');
    expect(result.declarations[0].name).toBe('Dog');
    expect(result.declarations[0].children.length).toBeGreaterThanOrEqual(2);
  });

  test('extracts interface declarations', () => {
    const result = typescriptParser.parse(
      `interface Config {\n  host: string;\n  port: number;\n}`,
      'test.ts',
    );
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].kind).toBe('InterfaceDef');
    expect(result.declarations[0].name).toBe('Config');
  });

  test('extracts type aliases', () => {
    const result = typescriptParser.parse(
      `type Status = 'active' | 'inactive' | 'pending';`,
      'test.ts',
    );
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].kind).toBe('TypeAlias');
    expect(result.declarations[0].name).toBe('Status');
  });

  test('extracts enum declarations', () => {
    const result = typescriptParser.parse(
      `enum Color {\n  Red,\n  Green,\n  Blue,\n}`,
      'test.ts',
    );
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].kind).toBe('EnumDef');
    expect(result.declarations[0].name).toBe('Color');
  });

  test('extracts variable declarations', () => {
    const result = typescriptParser.parse(
      `const MAX_SIZE = 100;`,
      'test.ts',
    );
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].kind).toBe('VariableDecl');
    expect(result.declarations[0].name).toBe('MAX_SIZE');
  });

  test('extracts multiple declarations', () => {
    const code = `
interface Config {
  host: string;
}

function createServer(config: Config) {
  return { config };
}

const DEFAULT_PORT = 3000;
`.trim();

    const result = typescriptParser.parse(code, 'server.ts');
    expect(result.declarations.length).toBe(3);
    const kinds = result.declarations.map((d) => d.kind);
    expect(kinds).toContain('InterfaceDef');
    expect(kinds).toContain('FunctionDef');
    expect(kinds).toContain('VariableDecl');
  });

  test('generates stable entity IDs', () => {
    const result = typescriptParser.parse(
      `function greet() {}`,
      'test.ts',
    );
    expect(result.declarations[0].id).toBe('FunctionDef:test.ts:greet');
  });

  test('produces structural signatures', () => {
    // Same function with different whitespace → same signature
    const a = typescriptParser.parse(`function f(x: number) {\n  return x;\n}`, 'a.ts');
    const b = typescriptParser.parse(`function f(x: number) { return x; }`, 'b.ts');
    expect(a.declarations[0].signature).toBe(b.declarations[0].signature);
  });
});

// ---------------------------------------------------------------------------
// Parsing imports
// ---------------------------------------------------------------------------

describe('typescriptParser.parse — imports', () => {
  test('extracts named imports', () => {
    const result = typescriptParser.parse(
      `import { readFile, writeFile } from 'fs';`,
      'test.ts',
    );
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('fs');
    expect(result.imports[0].specifiers).toEqual(['readFile', 'writeFile']);
  });

  test('extracts default imports', () => {
    const result = typescriptParser.parse(
      `import React from 'react';`,
      'test.ts',
    );
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].isDefault).toBe(true);
    expect(result.imports[0].specifiers).toEqual(['React']);
  });

  test('extracts namespace imports', () => {
    const result = typescriptParser.parse(
      `import * as path from 'path';`,
      'test.ts',
    );
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].isNamespace).toBe(true);
  });

  test('extracts type imports', () => {
    const result = typescriptParser.parse(
      `import type { Config } from './types.js';`,
      'test.ts',
    );
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].specifiers).toEqual(['Config']);
  });
});

// ---------------------------------------------------------------------------
// Parsing exports
// ---------------------------------------------------------------------------

describe('typescriptParser.parse — exports', () => {
  test('extracts re-exports', () => {
    const result = typescriptParser.parse(
      `export { foo, bar } from './module.js';`,
      'test.ts',
    );
    expect(result.exports.length).toBe(2);
  });

  test('extracts star exports', () => {
    const result = typescriptParser.parse(
      `export * from './utils.js';`,
      'test.ts',
    );
    expect(result.exports.length).toBe(1);
    expect(result.exports[0].name).toBe('*');
  });

  test('extracts default exports', () => {
    const result = typescriptParser.parse(
      `export default function main() {}`,
      'test.ts',
    );
    expect(result.exports.length).toBe(1);
    expect(result.exports[0].isDefault).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

describe('typescriptParser.diff', () => {
  test('detects added function', () => {
    const old = typescriptParser.parse(`function a() {}`, 'test.ts');
    const now = typescriptParser.parse(`function a() {}\nfunction b() {}`, 'test.ts');
    const patches = typescriptParser.diff(old, now);

    const adds = patches.filter((p) => p.kind === 'symbolAdd');
    expect(adds.length).toBe(1);
    expect(adds[0].kind === 'symbolAdd' && adds[0].entity.name).toBe('b');
  });

  test('detects removed function', () => {
    const old = typescriptParser.parse(`function a() {}\nfunction b() {}`, 'test.ts');
    const now = typescriptParser.parse(`function a() {}`, 'test.ts');
    const patches = typescriptParser.diff(old, now);

    const removes = patches.filter((p) => p.kind === 'symbolRemove');
    expect(removes.length).toBe(1);
  });

  test('detects modified function', () => {
    const old = typescriptParser.parse(
      `function greet() {\n  return "hello";\n}`,
      'test.ts',
    );
    const now = typescriptParser.parse(
      `function greet() {\n  return "goodbye";\n}`,
      'test.ts',
    );
    const patches = typescriptParser.diff(old, now);

    const mods = patches.filter((p) => p.kind === 'symbolModify');
    expect(mods.length).toBe(1);
  });

  test('detects added import', () => {
    const old = typescriptParser.parse(`import { a } from 'mod';`, 'test.ts');
    const now = typescriptParser.parse(
      `import { a } from 'mod';\nimport { b } from 'other';`,
      'test.ts',
    );
    const patches = typescriptParser.diff(old, now);

    const importAdds = patches.filter((p) => p.kind === 'importAdd');
    expect(importAdds.length).toBe(1);
  });

  test('detects removed import', () => {
    const old = typescriptParser.parse(
      `import { a } from 'mod';\nimport { b } from 'other';`,
      'test.ts',
    );
    const now = typescriptParser.parse(`import { a } from 'mod';`, 'test.ts');
    const patches = typescriptParser.diff(old, now);

    const importRemoves = patches.filter((p) => p.kind === 'importRemove');
    expect(importRemoves.length).toBe(1);
  });

  test('detects modified import specifiers', () => {
    const old = typescriptParser.parse(`import { a } from 'mod';`, 'test.ts');
    const now = typescriptParser.parse(`import { a, b } from 'mod';`, 'test.ts');
    const patches = typescriptParser.diff(old, now);

    const importMods = patches.filter((p) => p.kind === 'importModify');
    expect(importMods.length).toBe(1);
  });

  test('no patches for identical code', () => {
    const code = `function f() { return 1; }`;
    const old = typescriptParser.parse(code, 'test.ts');
    const now = typescriptParser.parse(code, 'test.ts');
    const patches = typescriptParser.diff(old, now);
    expect(patches.length).toBe(0);
  });

  test('detects renamed function', () => {
    const old = typescriptParser.parse(`function oldName(x: number) { return x; }`, 'test.ts');
    const now = typescriptParser.parse(`function newName(x: number) { return x; }`, 'test.ts');
    const patches = typescriptParser.diff(old, now);

    const renames = patches.filter((p) => p.kind === 'symbolRename');
    expect(renames.length).toBe(1);
    if (renames[0].kind === 'symbolRename') {
      expect(renames[0].oldName).toBe('oldName');
      expect(renames[0].newName).toBe('newName');
    }
  });
});

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

describe('typescriptParser — language', () => {
  test('detects TypeScript', () => {
    const result = typescriptParser.parse('', 'file.ts');
    expect(result.language).toBe('typescript');
  });

  test('detects JavaScript', () => {
    const result = typescriptParser.parse('', 'file.js');
    expect(result.language).toBe('javascript');
  });

  test('detects TSX', () => {
    const result = typescriptParser.parse('', 'file.tsx');
    expect(result.language).toBe('tsx');
  });
});

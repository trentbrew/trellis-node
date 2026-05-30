import { describe, test, expect } from 'vitest';
import { pythonParser } from '../../src/semantic/python-parser.js';

// ---------------------------------------------------------------------------
// Parse: declarations
// ---------------------------------------------------------------------------

describe('pythonParser.parse — declarations', () => {
  test('extracts top-level function', () => {
    const code = `def greet(name: str) -> str:\n    return f"Hello, {name}"`;
    const result = pythonParser.parse(code, 'app.py');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('greet');
    expect(result.declarations[0].kind).toBe('FunctionDef');
  });

  test('extracts async function', () => {
    const code = `async def fetch_data(url: str) -> dict:\n    async with aiohttp.ClientSession() as session:\n        return await session.get(url)`;
    const result = pythonParser.parse(code, 'api.py');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('fetch_data');
    expect(result.declarations[0].kind).toBe('FunctionDef');
  });

  test('extracts class with methods', () => {
    const code = [
      'class Animal:',
      '    name: str = ""',
      '',
      '    def __init__(self, name: str):',
      '        self.name = name',
      '',
      '    def speak(self) -> str:',
      '        return self.name',
      '',
      '    async def fetch(self):',
      '        pass',
    ].join('\n');

    const result = pythonParser.parse(code, 'models.py');
    expect(result.declarations.length).toBe(1);
    const cls = result.declarations[0];
    expect(cls.name).toBe('Animal');
    expect(cls.kind).toBe('ClassDef');

    const childNames = cls.children.map((c) => c.name);
    expect(childNames).toContain('__init__');
    expect(childNames).toContain('speak');
    expect(childNames).toContain('fetch');
    expect(childNames).toContain('name');

    const init = cls.children.find((c) => c.name === '__init__');
    expect(init?.kind).toBe('Constructor');

    const speak = cls.children.find((c) => c.name === 'speak');
    expect(speak?.kind).toBe('MethodDef');
  });

  test('extracts decorated function', () => {
    const code = [
      '@app.route("/api")',
      '@require_auth',
      'def api_handler(request):',
      '    return jsonify({"ok": True})',
    ].join('\n');

    const result = pythonParser.parse(code, 'routes.py');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('api_handler');
    // rawText should include decorators
    expect(result.declarations[0].rawText).toContain('@app.route');
    expect(result.declarations[0].rawText).toContain('@require_auth');
  });

  test('extracts decorated class', () => {
    const code = [
      '@dataclass',
      'class Point:',
      '    x: float = 0.0',
      '    y: float = 0.0',
    ].join('\n');

    const result = pythonParser.parse(code, 'types.py');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Point');
    expect(result.declarations[0].rawText).toContain('@dataclass');
  });

  test('extracts module-level variables', () => {
    const code = [
      'MAX_RETRIES = 3',
      'DEFAULT_HOST: str = "localhost"',
      'CONFIG = {',
      '    "debug": True,',
      '    "port": 8080,',
      '}',
    ].join('\n');

    const result = pythonParser.parse(code, 'config.py');
    const names = result.declarations.map((d) => d.name);
    expect(names).toContain('MAX_RETRIES');
    expect(names).toContain('DEFAULT_HOST');
    expect(names).toContain('CONFIG');
  });

  test('handles multiple top-level defs', () => {
    const code = [
      'def foo():',
      '    pass',
      '',
      'def bar():',
      '    pass',
      '',
      'class Baz:',
      '    pass',
    ].join('\n');

    const result = pythonParser.parse(code, 'multi.py');
    expect(result.declarations.length).toBe(3);
    expect(result.declarations.map((d) => d.name)).toEqual([
      'foo',
      'bar',
      'Baz',
    ]);
  });

  test('ignores indented defs (nested functions)', () => {
    const code = [
      'def outer():',
      '    def inner():',
      '        pass',
      '    return inner',
    ].join('\n');

    const result = pythonParser.parse(code, 'nested.py');
    // Only outer is a top-level declaration
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('outer');
  });
});

// ---------------------------------------------------------------------------
// Parse: imports
// ---------------------------------------------------------------------------

describe('pythonParser.parse — imports', () => {
  test('extracts import statement', () => {
    const code = 'import os';
    const result = pythonParser.parse(code, 'app.py');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('os');
    expect(result.imports[0].isDefault).toBe(true);
  });

  test('extracts from...import', () => {
    const code = 'from pathlib import Path, PurePath';
    const result = pythonParser.parse(code, 'app.py');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('pathlib');
    expect(result.imports[0].specifiers).toContain('Path');
    expect(result.imports[0].specifiers).toContain('PurePath');
  });

  test('extracts multi-line from...import', () => {
    const code = [
      'from typing import (',
      '    List,',
      '    Dict,',
      '    Optional,',
      ')',
    ].join('\n');

    const result = pythonParser.parse(code, 'types.py');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('typing');
    expect(result.imports[0].specifiers).toContain('List');
    expect(result.imports[0].specifiers).toContain('Dict');
    expect(result.imports[0].specifiers).toContain('Optional');
  });

  test('extracts wildcard import', () => {
    const code = 'from os.path import *';
    const result = pythonParser.parse(code, 'app.py');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].isNamespace).toBe(true);
  });

  test('extracts aliased import', () => {
    const code = 'import numpy as np';
    const result = pythonParser.parse(code, 'data.py');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('numpy');
    expect(result.imports[0].specifiers).toContain('np');
  });

  test('extracts multiple comma-separated imports', () => {
    const code = 'import os, sys, json';
    const result = pythonParser.parse(code, 'app.py');
    expect(result.imports.length).toBe(3);
    expect(result.imports.map((i) => i.source)).toEqual(['os', 'sys', 'json']);
  });
});

// ---------------------------------------------------------------------------
// Parse: exports (__all__)
// ---------------------------------------------------------------------------

describe('pythonParser.parse — exports', () => {
  test('extracts __all__', () => {
    const code = [
      '__all__ = ["Foo", "Bar", "baz"]',
      '',
      'class Foo: pass',
      'class Bar: pass',
      'def baz(): pass',
    ].join('\n');

    const result = pythonParser.parse(code, 'mod.py');
    const exportNames = result.exports.map((e) => e.name);
    expect(exportNames).toContain('Foo');
    expect(exportNames).toContain('Bar');
    expect(exportNames).toContain('baz');
  });

  test('returns empty exports when no __all__', () => {
    const code = 'def foo(): pass';
    const result = pythonParser.parse(code, 'app.py');
    expect(result.exports.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

describe('pythonParser.diff', () => {
  test('detects function addition', () => {
    const oldCode = 'def foo():\n    pass';
    const newCode = 'def foo():\n    pass\n\ndef bar():\n    pass';

    const oldResult = pythonParser.parse(oldCode, 'app.py');
    const newResult = pythonParser.parse(newCode, 'app.py');
    const patches = pythonParser.diff(oldResult, newResult);

    expect(patches.length).toBe(1);
    expect(patches[0].kind).toBe('symbolAdd');
    if (patches[0].kind === 'symbolAdd') {
      expect(patches[0].entity.name).toBe('bar');
    }
  });

  test('detects function removal', () => {
    const oldCode = 'def foo():\n    pass\n\ndef bar():\n    pass';
    const newCode = 'def foo():\n    pass';

    const oldResult = pythonParser.parse(oldCode, 'app.py');
    const newResult = pythonParser.parse(newCode, 'app.py');
    const patches = pythonParser.diff(oldResult, newResult);

    expect(patches.length).toBe(1);
    expect(patches[0].kind).toBe('symbolRemove');
    if (patches[0].kind === 'symbolRemove') {
      expect(patches[0].entityName).toBe('bar');
    }
  });

  test('detects function modification', () => {
    const oldCode = 'def greet():\n    return "hello"';
    const newCode = 'def greet():\n    return "goodbye"';

    const oldResult = pythonParser.parse(oldCode, 'app.py');
    const newResult = pythonParser.parse(newCode, 'app.py');
    const patches = pythonParser.diff(oldResult, newResult);

    expect(patches.length).toBe(1);
    expect(patches[0].kind).toBe('symbolModify');
  });

  test('detects function rename', () => {
    const oldCode = 'def calculate_sum(a, b):\n    return a + b';
    const newCode = 'def calculate_total(a, b):\n    return a + b';

    const oldResult = pythonParser.parse(oldCode, 'math.py');
    const newResult = pythonParser.parse(newCode, 'math.py');
    const patches = pythonParser.diff(oldResult, newResult);

    expect(patches.length).toBe(1);
    expect(patches[0].kind).toBe('symbolRename');
    if (patches[0].kind === 'symbolRename') {
      expect(patches[0].oldName).toBe('calculate_sum');
      expect(patches[0].newName).toBe('calculate_total');
    }
  });

  test('detects import changes', () => {
    const oldCode = 'import os\n\ndef main(): pass';
    const newCode = 'import os\nimport sys\n\ndef main(): pass';

    const oldResult = pythonParser.parse(oldCode, 'app.py');
    const newResult = pythonParser.parse(newCode, 'app.py');
    const patches = pythonParser.diff(oldResult, newResult);

    const importAdd = patches.find((p) => p.kind === 'importAdd');
    expect(importAdd).toBeDefined();
    if (importAdd?.kind === 'importAdd') {
      expect(importAdd.source).toBe('sys');
    }
  });

  test('detects class addition with members', () => {
    const oldCode = '';
    const newCode = [
      'class Dog:',
      '    def __init__(self, name):',
      '        self.name = name',
      '    def bark(self):',
      '        return "woof"',
    ].join('\n');

    const oldResult = pythonParser.parse(oldCode, 'animals.py');
    const newResult = pythonParser.parse(newCode, 'animals.py');
    const patches = pythonParser.diff(oldResult, newResult);

    expect(patches.length).toBe(1);
    expect(patches[0].kind).toBe('symbolAdd');
    if (patches[0].kind === 'symbolAdd') {
      expect(patches[0].entity.name).toBe('Dog');
      expect(patches[0].entity.children.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: engine parseFile
// ---------------------------------------------------------------------------

describe('pythonParser — engine integration', () => {
  test('parse result has correct structure', () => {
    const code = [
      'from typing import Optional',
      '',
      '__all__ = ["MyService"]',
      '',
      'class MyService:',
      '    """A service class."""',
      '',
      '    def __init__(self, config: dict):',
      '        self.config = config',
      '',
      '    async def run(self) -> None:',
      '        pass',
      '',
      'def helper() -> Optional[str]:',
      '    return None',
    ].join('\n');

    const result = pythonParser.parse(code, 'service.py');

    expect(result.language).toBe('python');
    expect(result.fileEntityId).toBe('file:service.py');
    expect(result.imports.length).toBe(1);
    expect(result.exports.length).toBe(1);
    expect(result.exports[0].name).toBe('MyService');
    expect(result.declarations.length).toBe(2); // MyService class + helper function

    const cls = result.declarations.find((d) => d.name === 'MyService');
    expect(cls?.kind).toBe('ClassDef');
    expect(cls?.children.length).toBeGreaterThanOrEqual(2);

    const helper = result.declarations.find((d) => d.name === 'helper');
    expect(helper?.kind).toBe('FunctionDef');
  });
});

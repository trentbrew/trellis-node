import { describe, test, expect } from 'vitest';
import { csharpParser } from '../../src/semantic/csharp-parser.js';

// ---------------------------------------------------------------------------
// Parse: declarations
// ---------------------------------------------------------------------------

describe('csharpParser.parse — declarations', () => {
  test('extracts public class', () => {
    const code = [
      'namespace MyApp;',
      '',
      'public class Server {',
      '}',
    ].join('\n');

    const result = csharpParser.parse(code, 'Server.cs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Server');
    expect(result.declarations[0].kind).toBe('ClassDef');
  });

  test('extracts interface', () => {
    const code = [
      'public interface IRepository {',
      '    void Save(object entity);',
      '}',
    ].join('\n');

    const result = csharpParser.parse(code, 'IRepository.cs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('IRepository');
    expect(result.declarations[0].kind).toBe('InterfaceDef');
  });

  test('extracts struct', () => {
    const code = [
      'public struct Point {',
      '    public int X;',
      '    public int Y;',
      '}',
    ].join('\n');

    const result = csharpParser.parse(code, 'Point.cs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Point');
    expect(result.declarations[0].kind).toBe('ClassDef');
  });

  test('extracts enum', () => {
    const code = [
      'public enum Color {',
      '    Red,',
      '    Green,',
      '    Blue',
      '}',
    ].join('\n');

    const result = csharpParser.parse(code, 'Color.cs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Color');
    expect(result.declarations[0].kind).toBe('EnumDef');
  });

  test('extracts record', () => {
    const code = 'public record Person(string Name, int Age) { }';
    const result = csharpParser.parse(code, 'Person.cs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Person');
  });

  test('extracts class with members', () => {
    const code = [
      'public class User {',
      '    private string _name;',
      '    public string Name { get; set; }',
      '',
      '    public User(string name) {',
      '        _name = name;',
      '    }',
      '',
      '    public string GetName() {',
      '        return _name;',
      '    }',
      '',
      '    public void SetName(string name) {',
      '        _name = name;',
      '    }',
      '}',
    ].join('\n');

    const result = csharpParser.parse(code, 'User.cs');
    expect(result.declarations.length).toBe(1);
    const cls = result.declarations[0];
    expect(cls.name).toBe('User');

    const fields = cls.children.filter(c => c.kind === 'PropertyDef');
    expect(fields.length).toBeGreaterThanOrEqual(2); // _name field + Name property

    const ctor = cls.children.find(c => c.kind === 'Constructor');
    expect(ctor).toBeDefined();

    const methods = cls.children.filter(c => c.kind === 'MethodDef');
    expect(methods.map(m => m.name)).toContain('GetName');
    expect(methods.map(m => m.name)).toContain('SetName');
  });

  test('extracts attributed class', () => {
    const code = [
      '[Serializable]',
      '[Table("users")]',
      'public class UserEntity {',
      '}',
    ].join('\n');

    const result = csharpParser.parse(code, 'UserEntity.cs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('UserEntity');
    expect(result.declarations[0].rawText).toContain('[Serializable]');
  });

  test('extracts abstract class', () => {
    const code = [
      'public abstract class Shape {',
      '    public abstract double Area();',
      '}',
    ].join('\n');

    const result = csharpParser.parse(code, 'Shape.cs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Shape');
  });
});

// ---------------------------------------------------------------------------
// Parse: imports
// ---------------------------------------------------------------------------

describe('csharpParser.parse — imports', () => {
  test('extracts using directive', () => {
    const code = 'using System.Collections.Generic;';
    const result = csharpParser.parse(code, 'App.cs');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('System.Collections.Generic');
    expect(result.imports[0].specifiers).toEqual(['Generic']);
  });

  test('extracts using static', () => {
    const code = 'using static System.Math;';
    const result = csharpParser.parse(code, 'App.cs');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('System.Math');
  });

  test('extracts using alias', () => {
    const code = 'using Dict = System.Collections.Generic.Dictionary<string, object>;';
    const result = csharpParser.parse(code, 'App.cs');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].specifiers).toEqual(['Dict']);
  });

  test('extracts multiple usings', () => {
    const code = [
      'using System;',
      'using System.Linq;',
      'using System.Collections.Generic;',
    ].join('\n');

    const result = csharpParser.parse(code, 'App.cs');
    expect(result.imports.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Parse: exports
// ---------------------------------------------------------------------------

describe('csharpParser.parse — exports', () => {
  test('public types are exported', () => {
    const code = 'public class MyService { }';
    const result = csharpParser.parse(code, 'MyService.cs');
    expect(result.exports.length).toBe(1);
    expect(result.exports[0].name).toBe('MyService');
  });

  test('internal types are not exported', () => {
    const code = 'internal class InternalClass { }';
    const result = csharpParser.parse(code, 'Internal.cs');
    expect(result.exports.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

describe('csharpParser.diff', () => {
  test('detects class addition', () => {
    const oldCode = 'public class Foo { }';
    const newCode = 'public class Foo { }\n\npublic class Bar { }';

    const patches = csharpParser.diff(
      csharpParser.parse(oldCode, 'App.cs'),
      csharpParser.parse(newCode, 'App.cs'),
    );

    const adds = patches.filter(p => p.kind === 'symbolAdd');
    expect(adds.length).toBe(1);
    if (adds[0].kind === 'symbolAdd') expect(adds[0].entity.name).toBe('Bar');
  });

  test('detects class removal', () => {
    const oldCode = 'public class Foo { }\n\npublic class Bar { }';
    const newCode = 'public class Foo { }';

    const patches = csharpParser.diff(
      csharpParser.parse(oldCode, 'App.cs'),
      csharpParser.parse(newCode, 'App.cs'),
    );

    const removes = patches.filter(p => p.kind === 'symbolRemove');
    expect(removes.length).toBe(1);
  });

  test('detects modification', () => {
    const oldCode = 'public class Foo {\n    int x = 1;\n}';
    const newCode = 'public class Foo {\n    int x = 2;\n}';

    const patches = csharpParser.diff(
      csharpParser.parse(oldCode, 'App.cs'),
      csharpParser.parse(newCode, 'App.cs'),
    );

    expect(patches.some(p => p.kind === 'symbolModify')).toBe(true);
  });

  test('detects import addition', () => {
    const oldCode = 'using System;\n\npublic class App { }';
    const newCode = 'using System;\nusing System.Linq;\n\npublic class App { }';

    const patches = csharpParser.diff(
      csharpParser.parse(oldCode, 'App.cs'),
      csharpParser.parse(newCode, 'App.cs'),
    );

    const importAdd = patches.find(p => p.kind === 'importAdd');
    expect(importAdd).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe('csharpParser — integration', () => {
  test('full C# file parses correctly', () => {
    const code = [
      'using System;',
      'using System.Collections.Generic;',
      '',
      'namespace MyApp.Services;',
      '',
      'public class UserService {',
      '    private readonly IRepository _repo;',
      '    public string ServiceName { get; set; }',
      '',
      '    public UserService(IRepository repo) {',
      '        _repo = repo;',
      '    }',
      '',
      '    public List<User> FindAll() {',
      '        return _repo.FindAll();',
      '    }',
      '',
      '    public User FindById(string id) {',
      '        return _repo.FindById(id);',
      '    }',
      '}',
    ].join('\n');

    const result = csharpParser.parse(code, 'UserService.cs');
    expect(result.language).toBe('csharp');
    expect(result.imports.length).toBe(2);
    expect(result.declarations.length).toBe(1);

    const cls = result.declarations[0];
    expect(cls.name).toBe('UserService');
    expect(cls.children.length).toBeGreaterThanOrEqual(4); // fields + properties + ctor + methods
  });
});

import { describe, test, expect } from 'vitest';
import { javaParser } from '../../src/semantic/java-parser.js';

// ---------------------------------------------------------------------------
// Parse: declarations
// ---------------------------------------------------------------------------

describe('javaParser.parse — declarations', () => {
  test('extracts public class', () => {
    const code = [
      'package com.example;',
      '',
      'public class Server {',
      '}',
    ].join('\n');

    const result = javaParser.parse(code, 'Server.java');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Server');
    expect(result.declarations[0].kind).toBe('ClassDef');
  });

  test('extracts interface', () => {
    const code = [
      'public interface Repository {',
      '    void save(Object entity);',
      '    Object findById(String id);',
      '}',
    ].join('\n');

    const result = javaParser.parse(code, 'Repository.java');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Repository');
    expect(result.declarations[0].kind).toBe('InterfaceDef');
  });

  test('extracts enum', () => {
    const code = [
      'public enum Color {',
      '    RED, GREEN, BLUE;',
      '}',
    ].join('\n');

    const result = javaParser.parse(code, 'Color.java');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Color');
    expect(result.declarations[0].kind).toBe('EnumDef');
  });

  test('extracts class with methods and fields', () => {
    const code = [
      'public class User {',
      '    private String name;',
      '    private int age;',
      '',
      '    public User(String name, int age) {',
      '        this.name = name;',
      '        this.age = age;',
      '    }',
      '',
      '    public String getName() {',
      '        return name;',
      '    }',
      '',
      '    public void setName(String name) {',
      '        this.name = name;',
      '    }',
      '}',
    ].join('\n');

    const result = javaParser.parse(code, 'User.java');
    expect(result.declarations.length).toBe(1);
    const cls = result.declarations[0];
    expect(cls.name).toBe('User');

    const fields = cls.children.filter(c => c.kind === 'PropertyDef');
    expect(fields.map(f => f.name)).toContain('name');
    expect(fields.map(f => f.name)).toContain('age');

    const ctor = cls.children.find(c => c.kind === 'Constructor');
    expect(ctor).toBeDefined();

    const methods = cls.children.filter(c => c.kind === 'MethodDef');
    expect(methods.map(m => m.name)).toContain('getName');
    expect(methods.map(m => m.name)).toContain('setName');
  });

  test('extracts annotated class', () => {
    const code = [
      '@Entity',
      '@Table(name = "users")',
      'public class UserEntity {',
      '}',
    ].join('\n');

    const result = javaParser.parse(code, 'UserEntity.java');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('UserEntity');
    expect(result.declarations[0].rawText).toContain('@Entity');
  });

  test('extracts abstract class', () => {
    const code = [
      'public abstract class Shape {',
      '    public abstract double area();',
      '}',
    ].join('\n');

    const result = javaParser.parse(code, 'Shape.java');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Shape');
  });
});

// ---------------------------------------------------------------------------
// Parse: imports
// ---------------------------------------------------------------------------

describe('javaParser.parse — imports', () => {
  test('extracts single import', () => {
    const code = 'import java.util.List;';
    const result = javaParser.parse(code, 'App.java');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('java.util.List');
    expect(result.imports[0].specifiers).toEqual(['List']);
  });

  test('extracts wildcard import', () => {
    const code = 'import java.util.*;';
    const result = javaParser.parse(code, 'App.java');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('java.util');
    expect(result.imports[0].isNamespace).toBe(true);
  });

  test('extracts static import', () => {
    const code = 'import static org.junit.Assert.assertEquals;';
    const result = javaParser.parse(code, 'Test.java');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('org.junit.Assert.assertEquals');
  });

  test('extracts multiple imports', () => {
    const code = [
      'import java.util.List;',
      'import java.util.Map;',
      'import java.io.File;',
    ].join('\n');

    const result = javaParser.parse(code, 'App.java');
    expect(result.imports.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Parse: exports
// ---------------------------------------------------------------------------

describe('javaParser.parse — exports', () => {
  test('public classes are exported', () => {
    const code = [
      'public class PublicClass {',
      '}',
    ].join('\n');

    const result = javaParser.parse(code, 'PublicClass.java');
    expect(result.exports.length).toBe(1);
    expect(result.exports[0].name).toBe('PublicClass');
  });

  test('package-private classes are not exported', () => {
    const code = [
      'class PackagePrivate {',
      '}',
    ].join('\n');

    const result = javaParser.parse(code, 'Internal.java');
    expect(result.exports.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

describe('javaParser.diff', () => {
  test('detects class addition', () => {
    const oldCode = 'public class Foo {}';
    const newCode = 'public class Foo {}\n\npublic class Bar {}';

    const patches = javaParser.diff(
      javaParser.parse(oldCode, 'App.java'),
      javaParser.parse(newCode, 'App.java'),
    );

    const adds = patches.filter(p => p.kind === 'symbolAdd');
    expect(adds.length).toBe(1);
    if (adds[0].kind === 'symbolAdd') expect(adds[0].entity.name).toBe('Bar');
  });

  test('detects class removal', () => {
    const oldCode = 'public class Foo {}\n\npublic class Bar {}';
    const newCode = 'public class Foo {}';

    const patches = javaParser.diff(
      javaParser.parse(oldCode, 'App.java'),
      javaParser.parse(newCode, 'App.java'),
    );

    const removes = patches.filter(p => p.kind === 'symbolRemove');
    expect(removes.length).toBe(1);
  });

  test('detects modification', () => {
    const oldCode = 'public class Foo {\n    int x = 1;\n}';
    const newCode = 'public class Foo {\n    int x = 2;\n}';

    const patches = javaParser.diff(
      javaParser.parse(oldCode, 'App.java'),
      javaParser.parse(newCode, 'App.java'),
    );

    expect(patches.some(p => p.kind === 'symbolModify')).toBe(true);
  });

  test('detects import addition', () => {
    const oldCode = 'import java.util.List;\n\npublic class App {}';
    const newCode = 'import java.util.List;\nimport java.util.Map;\n\npublic class App {}';

    const patches = javaParser.diff(
      javaParser.parse(oldCode, 'App.java'),
      javaParser.parse(newCode, 'App.java'),
    );

    const importAdd = patches.find(p => p.kind === 'importAdd');
    expect(importAdd).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe('javaParser — integration', () => {
  test('full Java file parses correctly', () => {
    const code = [
      'package com.example.service;',
      '',
      'import java.util.List;',
      'import java.util.Optional;',
      '',
      '@Service',
      'public class UserService {',
      '    private final UserRepository repo;',
      '',
      '    public UserService(UserRepository repo) {',
      '        this.repo = repo;',
      '    }',
      '',
      '    public List<User> findAll() {',
      '        return repo.findAll();',
      '    }',
      '',
      '    public Optional<User> findById(String id) {',
      '        return repo.findById(id);',
      '    }',
      '}',
    ].join('\n');

    const result = javaParser.parse(code, 'UserService.java');
    expect(result.language).toBe('java');
    expect(result.imports.length).toBe(2);
    expect(result.declarations.length).toBe(1);

    const cls = result.declarations[0];
    expect(cls.name).toBe('UserService');
    expect(cls.children.length).toBeGreaterThanOrEqual(3); // repo field + constructor + 2 methods
  });
});

import { describe, test, expect } from 'vitest';
import { goParser } from '../../src/semantic/go-parser.js';

// ---------------------------------------------------------------------------
// Parse: declarations
// ---------------------------------------------------------------------------

describe('goParser.parse — declarations', () => {
  test('extracts top-level function', () => {
    const code = [
      'package main',
      '',
      'func Hello(name string) string {',
      '    return "Hello, " + name',
      '}',
    ].join('\n');

    const result = goParser.parse(code, 'main.go');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Hello');
    expect(result.declarations[0].kind).toBe('FunctionDef');
  });

  test('extracts method with receiver', () => {
    const code = [
      'package main',
      '',
      'func (s *Server) Start() error {',
      '    return nil',
      '}',
    ].join('\n');

    const result = goParser.parse(code, 'server.go');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Start');
    expect(result.declarations[0].kind).toBe('MethodDef');
  });

  test('extracts struct with fields', () => {
    const code = [
      'package main',
      '',
      'type Server struct {',
      '    Host string',
      '    Port int',
      '    TLS  bool',
      '}',
    ].join('\n');

    const result = goParser.parse(code, 'server.go');
    expect(result.declarations.length).toBe(1);
    const s = result.declarations[0];
    expect(s.name).toBe('Server');
    expect(s.kind).toBe('ClassDef');
    expect(s.children.length).toBe(3);
    expect(s.children.map(c => c.name)).toEqual(['Host', 'Port', 'TLS']);
  });

  test('extracts interface with methods', () => {
    const code = [
      'package io',
      '',
      'type Reader interface {',
      '    Read(p []byte) (n int, err error)',
      '}',
    ].join('\n');

    const result = goParser.parse(code, 'io.go');
    expect(result.declarations.length).toBe(1);
    const iface = result.declarations[0];
    expect(iface.name).toBe('Reader');
    expect(iface.kind).toBe('InterfaceDef');
    expect(iface.children.length).toBe(1);
    expect(iface.children[0].name).toBe('Read');
  });

  test('extracts type alias', () => {
    const code = [
      'package main',
      '',
      'type Duration int64',
    ].join('\n');

    const result = goParser.parse(code, 'types.go');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Duration');
    expect(result.declarations[0].kind).toBe('TypeAlias');
  });

  test('extracts const block', () => {
    const code = [
      'package http',
      '',
      'const (',
      '    StatusOK       = 200',
      '    StatusNotFound = 404',
      ')',
    ].join('\n');

    const result = goParser.parse(code, 'status.go');
    expect(result.declarations.length).toBe(2);
    expect(result.declarations.map(d => d.name)).toEqual(['StatusOK', 'StatusNotFound']);
  });

  test('extracts single const', () => {
    const code = [
      'package main',
      '',
      'const MaxRetries = 3',
    ].join('\n');

    const result = goParser.parse(code, 'config.go');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('MaxRetries');
  });

  test('extracts var declaration', () => {
    const code = [
      'package main',
      '',
      'var DefaultClient = &http.Client{}',
    ].join('\n');

    const result = goParser.parse(code, 'client.go');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('DefaultClient');
  });

  test('handles multiple declarations', () => {
    const code = [
      'package main',
      '',
      'func Foo() {}',
      '',
      'func Bar() {}',
      '',
      'type Baz struct {}',
    ].join('\n');

    const result = goParser.parse(code, 'multi.go');
    expect(result.declarations.length).toBe(3);
    expect(result.declarations.map(d => d.name)).toEqual(['Foo', 'Bar', 'Baz']);
  });
});

// ---------------------------------------------------------------------------
// Parse: imports
// ---------------------------------------------------------------------------

describe('goParser.parse — imports', () => {
  test('extracts single import', () => {
    const code = [
      'package main',
      '',
      'import "fmt"',
    ].join('\n');

    const result = goParser.parse(code, 'main.go');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('fmt');
  });

  test('extracts import block', () => {
    const code = [
      'package main',
      '',
      'import (',
      '    "fmt"',
      '    "os"',
      '    "net/http"',
      ')',
    ].join('\n');

    const result = goParser.parse(code, 'main.go');
    expect(result.imports.length).toBe(3);
    expect(result.imports.map(i => i.source)).toEqual(['fmt', 'os', 'net/http']);
    // net/http should have specifier "http"
    expect(result.imports[2].specifiers).toEqual(['http']);
  });

  test('extracts aliased import', () => {
    const code = [
      'package main',
      '',
      'import (',
      '    pb "google.golang.org/protobuf"',
      ')',
    ].join('\n');

    const result = goParser.parse(code, 'main.go');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('google.golang.org/protobuf');
    expect(result.imports[0].specifiers).toEqual(['pb']);
  });

  test('extracts dot import', () => {
    const code = [
      'package test',
      '',
      'import (',
      '    . "testing"',
      ')',
    ].join('\n');

    const result = goParser.parse(code, 'test.go');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].isNamespace).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Parse: exports
// ---------------------------------------------------------------------------

describe('goParser.parse — exports', () => {
  test('uppercase names are exported', () => {
    const code = [
      'package main',
      '',
      'func PublicFunc() {}',
      'func privateFunc() {}',
      'type PublicType struct {}',
    ].join('\n');

    const result = goParser.parse(code, 'api.go');
    const exportNames = result.exports.map(e => e.name);
    expect(exportNames).toContain('PublicFunc');
    expect(exportNames).toContain('PublicType');
    expect(exportNames).not.toContain('privateFunc');
  });
});

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

describe('goParser.diff', () => {
  test('detects function addition', () => {
    const oldCode = 'package main\n\nfunc Foo() {}';
    const newCode = 'package main\n\nfunc Foo() {}\n\nfunc Bar() {}';

    const oldResult = goParser.parse(oldCode, 'main.go');
    const newResult = goParser.parse(newCode, 'main.go');
    const patches = goParser.diff(oldResult, newResult);

    const adds = patches.filter(p => p.kind === 'symbolAdd');
    expect(adds.length).toBe(1);
    if (adds[0].kind === 'symbolAdd') {
      expect(adds[0].entity.name).toBe('Bar');
    }
  });

  test('detects function removal', () => {
    const oldCode = 'package main\n\nfunc Foo() {}\n\nfunc Bar() {}';
    const newCode = 'package main\n\nfunc Foo() {}';

    const oldResult = goParser.parse(oldCode, 'main.go');
    const newResult = goParser.parse(newCode, 'main.go');
    const patches = goParser.diff(oldResult, newResult);

    const removes = patches.filter(p => p.kind === 'symbolRemove');
    expect(removes.length).toBe(1);
    if (removes[0].kind === 'symbolRemove') {
      expect(removes[0].entityName).toBe('Bar');
    }
  });

  test('detects function modification', () => {
    const oldCode = 'package main\n\nfunc Greet() string {\n    return "hello"\n}';
    const newCode = 'package main\n\nfunc Greet() string {\n    return "goodbye"\n}';

    const oldResult = goParser.parse(oldCode, 'main.go');
    const newResult = goParser.parse(newCode, 'main.go');
    const patches = goParser.diff(oldResult, newResult);

    expect(patches.length).toBe(1);
    expect(patches[0].kind).toBe('symbolModify');
  });

  test('detects import changes', () => {
    const oldCode = 'package main\n\nimport "fmt"\n\nfunc main() {}';
    const newCode = 'package main\n\nimport "fmt"\nimport "os"\n\nfunc main() {}';

    const oldResult = goParser.parse(oldCode, 'main.go');
    const newResult = goParser.parse(newCode, 'main.go');
    const patches = goParser.diff(oldResult, newResult);

    const importAdd = patches.find(p => p.kind === 'importAdd');
    expect(importAdd).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe('goParser — integration', () => {
  test('full Go file parses correctly', () => {
    const code = [
      'package server',
      '',
      'import (',
      '    "fmt"',
      '    "net/http"',
      ')',
      '',
      'type Handler struct {',
      '    Name string',
      '}',
      '',
      'func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {',
      '    fmt.Fprintf(w, "Hello from %s", h.Name)',
      '}',
      '',
      'func NewHandler(name string) *Handler {',
      '    return &Handler{Name: name}',
      '}',
    ].join('\n');

    const result = goParser.parse(code, 'server.go');
    expect(result.language).toBe('go');
    expect(result.imports.length).toBe(2);
    expect(result.declarations.length).toBe(3); // Handler struct + ServeHTTP method + NewHandler func
    expect(result.exports.length).toBe(3); // Handler, ServeHTTP, NewHandler (all uppercase)
  });
});

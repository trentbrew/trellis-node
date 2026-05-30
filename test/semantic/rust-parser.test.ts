import { describe, test, expect } from 'vitest';
import { rustParser } from '../../src/semantic/rust-parser.js';

// ---------------------------------------------------------------------------
// Parse: declarations
// ---------------------------------------------------------------------------

describe('rustParser.parse — declarations', () => {
  test('extracts top-level function', () => {
    const code = [
      'fn greet(name: &str) -> String {',
      '    format!("Hello, {}", name)',
      '}',
    ].join('\n');

    const result = rustParser.parse(code, 'main.rs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('greet');
    expect(result.declarations[0].kind).toBe('FunctionDef');
  });

  test('extracts pub async function', () => {
    const code = [
      'pub async fn fetch_data(url: &str) -> Result<String, Error> {',
      '    Ok(String::new())',
      '}',
    ].join('\n');

    const result = rustParser.parse(code, 'api.rs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('fetch_data');
  });

  test('extracts struct with fields', () => {
    const code = [
      'pub struct Server {',
      '    pub host: String,',
      '    port: u16,',
      '    tls: bool,',
      '}',
    ].join('\n');

    const result = rustParser.parse(code, 'server.rs');
    expect(result.declarations.length).toBe(1);
    const s = result.declarations[0];
    expect(s.name).toBe('Server');
    expect(s.kind).toBe('ClassDef');
    expect(s.children.length).toBe(3);
    expect(s.children.map((c) => c.name)).toEqual(['host', 'port', 'tls']);
  });

  test('extracts enum', () => {
    const code = [
      'pub enum Color {',
      '    Red,',
      '    Green,',
      '    Blue,',
      '}',
    ].join('\n');

    const result = rustParser.parse(code, 'types.rs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Color');
    expect(result.declarations[0].kind).toBe('EnumDef');
  });

  test('extracts trait with methods', () => {
    const code = [
      'pub trait Drawable {',
      '    fn draw(&self);',
      '    fn resize(&mut self, w: u32, h: u32);',
      '}',
    ].join('\n');

    const result = rustParser.parse(code, 'traits.rs');
    expect(result.declarations.length).toBe(1);
    const t = result.declarations[0];
    expect(t.name).toBe('Drawable');
    expect(t.kind).toBe('InterfaceDef');
    expect(t.children.length).toBe(2);
    expect(t.children.map((c) => c.name)).toEqual(['draw', 'resize']);
  });

  test('extracts impl block with methods', () => {
    const code = [
      'impl Server {',
      '    pub fn new(host: String) -> Self {',
      '        Server { host, port: 8080, tls: false }',
      '    }',
      '',
      '    pub fn start(&self) {',
      '        println!("Starting...");',
      '    }',
      '}',
    ].join('\n');

    const result = rustParser.parse(code, 'server.rs');
    expect(result.declarations.length).toBe(1);
    const impl = result.declarations[0];
    expect(impl.name).toBe('Server');
    expect(impl.children.length).toBe(2);

    const newMethod = impl.children.find((c) => c.name === 'new');
    expect(newMethod?.kind).toBe('Constructor');

    const startMethod = impl.children.find((c) => c.name === 'start');
    expect(startMethod?.kind).toBe('MethodDef');
  });

  test('extracts trait impl', () => {
    const code = [
      'impl Display for Server {',
      '    fn fmt(&self, f: &mut Formatter) -> fmt::Result {',
      '        write!(f, "{}:{}", self.host, self.port)',
      '    }',
      '}',
    ].join('\n');

    const result = rustParser.parse(code, 'server.rs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Display for Server');
    expect(result.declarations[0].children.length).toBe(1);
    expect(result.declarations[0].children[0].name).toBe('fmt');
  });

  test('extracts type alias', () => {
    const code = 'type Result<T> = std::result::Result<T, MyError>;';
    const result = rustParser.parse(code, 'types.rs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Result');
    expect(result.declarations[0].kind).toBe('TypeAlias');
  });

  test('extracts const and static', () => {
    const code = [
      'const MAX_SIZE: usize = 1024;',
      'static GLOBAL: AtomicU32 = AtomicU32::new(0);',
    ].join('\n');

    const result = rustParser.parse(code, 'config.rs');
    expect(result.declarations.length).toBe(2);
    expect(result.declarations.map((d) => d.name)).toEqual([
      'MAX_SIZE',
      'GLOBAL',
    ]);
  });

  test('extracts macro_rules', () => {
    const code = [
      'macro_rules! vec_of {',
      '    ($($x:expr),*) => {',
      '        vec![$($x),*]',
      '    };',
      '}',
    ].join('\n');

    const result = rustParser.parse(code, 'macros.rs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('vec_of');
  });

  test('extracts decorated (attributed) items', () => {
    const code = [
      '#[derive(Debug, Clone)]',
      '#[serde(rename_all = "camelCase")]',
      'pub struct Config {',
      '    pub name: String,',
      '}',
    ].join('\n');

    const result = rustParser.parse(code, 'config.rs');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Config');
    expect(result.declarations[0].rawText).toContain('#[derive(Debug, Clone)]');
  });
});

// ---------------------------------------------------------------------------
// Parse: imports (use statements)
// ---------------------------------------------------------------------------

describe('rustParser.parse — imports', () => {
  test('extracts simple use', () => {
    const code = 'use std::io::Read;';
    const result = rustParser.parse(code, 'main.rs');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('std::io::Read');
    expect(result.imports[0].specifiers).toEqual(['Read']);
  });

  test('extracts grouped use', () => {
    const code = 'use std::collections::{HashMap, HashSet, BTreeMap};';
    const result = rustParser.parse(code, 'main.rs');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('std::collections');
    expect(result.imports[0].specifiers).toContain('HashMap');
    expect(result.imports[0].specifiers).toContain('HashSet');
    expect(result.imports[0].specifiers).toContain('BTreeMap');
  });

  test('extracts wildcard use', () => {
    const code = 'use std::prelude::*;';
    const result = rustParser.parse(code, 'main.rs');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].isNamespace).toBe(true);
  });

  test('extracts aliased use', () => {
    const code = 'use std::io::Result as IoResult;';
    const result = rustParser.parse(code, 'main.rs');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].specifiers).toEqual(['IoResult']);
  });
});

// ---------------------------------------------------------------------------
// Parse: exports
// ---------------------------------------------------------------------------

describe('rustParser.parse — exports', () => {
  test('pub items are exported', () => {
    const code = [
      'pub fn public_fn() {}',
      'fn private_fn() {}',
      'pub struct PublicStruct {}',
    ].join('\n');

    const result = rustParser.parse(code, 'lib.rs');
    const exportNames = result.exports.map((e) => e.name);
    expect(exportNames).toContain('public_fn');
    expect(exportNames).toContain('PublicStruct');
    expect(exportNames).not.toContain('private_fn');
  });
});

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

describe('rustParser.diff', () => {
  test('detects function addition', () => {
    const oldCode = 'fn foo() {}';
    const newCode = 'fn foo() {}\n\nfn bar() {}';

    const patches = rustParser.diff(
      rustParser.parse(oldCode, 'lib.rs'),
      rustParser.parse(newCode, 'lib.rs'),
    );

    const adds = patches.filter((p) => p.kind === 'symbolAdd');
    expect(adds.length).toBe(1);
    if (adds[0].kind === 'symbolAdd') expect(adds[0].entity.name).toBe('bar');
  });

  test('detects function removal', () => {
    const oldCode = 'fn foo() {}\n\nfn bar() {}';
    const newCode = 'fn foo() {}';

    const patches = rustParser.diff(
      rustParser.parse(oldCode, 'lib.rs'),
      rustParser.parse(newCode, 'lib.rs'),
    );

    const removes = patches.filter((p) => p.kind === 'symbolRemove');
    expect(removes.length).toBe(1);
    if (removes[0].kind === 'symbolRemove')
      expect(removes[0].entityName).toBe('bar');
  });

  test('detects modification', () => {
    const oldCode = 'fn greet() -> &str {\n    "hello"\n}';
    const newCode = 'fn greet() -> &str {\n    "goodbye"\n}';

    const patches = rustParser.diff(
      rustParser.parse(oldCode, 'lib.rs'),
      rustParser.parse(newCode, 'lib.rs'),
    );

    expect(patches.length).toBe(1);
    expect(patches[0].kind).toBe('symbolModify');
  });

  test('detects import addition', () => {
    const oldCode = 'use std::io;\n\nfn main() {}';
    const newCode = 'use std::io;\nuse std::fs;\n\nfn main() {}';

    const patches = rustParser.diff(
      rustParser.parse(oldCode, 'main.rs'),
      rustParser.parse(newCode, 'main.rs'),
    );

    const importAdd = patches.find((p) => p.kind === 'importAdd');
    expect(importAdd).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe('rustParser — integration', () => {
  test('full Rust file parses correctly', () => {
    const code = [
      'use std::collections::HashMap;',
      'use std::io::{self, Read};',
      '',
      '#[derive(Debug)]',
      'pub struct Cache {',
      '    data: HashMap<String, String>,',
      '}',
      '',
      'impl Cache {',
      '    pub fn new() -> Self {',
      '        Cache { data: HashMap::new() }',
      '    }',
      '',
      '    pub fn get(&self, key: &str) -> Option<&String> {',
      '        self.data.get(key)',
      '    }',
      '}',
      '',
      'pub trait Storage {',
      '    fn save(&self, key: &str, value: &str);',
      '    fn load(&self, key: &str) -> Option<String>;',
      '}',
    ].join('\n');

    const result = rustParser.parse(code, 'cache.rs');
    expect(result.language).toBe('rust');
    expect(result.imports.length).toBe(2);
    expect(result.declarations.length).toBe(3); // Cache struct, impl Cache, Storage trait

    const cache = result.declarations.find(
      (d) => d.name === 'Cache' && d.kind === 'ClassDef',
    );
    expect(cache).toBeDefined();
    expect(cache!.children.length).toBe(1); // data field

    const trait_ = result.declarations.find((d) => d.name === 'Storage');
    expect(trait_?.kind).toBe('InterfaceDef');
    expect(trait_!.children.length).toBe(2);

    expect(result.exports.length).toBeGreaterThanOrEqual(2); // Cache, new, get, Storage
  });
});

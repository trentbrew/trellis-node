import { describe, test, expect } from 'vitest';
import { rubyParser } from '../../src/semantic/ruby-parser.js';

// ---------------------------------------------------------------------------
// Parse: declarations
// ---------------------------------------------------------------------------

describe('rubyParser.parse — declarations', () => {
  test('extracts top-level method', () => {
    const code = [
      'def greet(name)',
      '  "Hello, #{name}"',
      'end',
    ].join('\n');

    const result = rubyParser.parse(code, 'app.rb');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('greet');
    expect(result.declarations[0].kind).toBe('FunctionDef');
  });

  test('extracts class with methods', () => {
    const code = [
      'class Server',
      '  def initialize(host, port)',
      '    @host = host',
      '    @port = port',
      '  end',
      '',
      '  def start',
      '    puts "Starting..."',
      '  end',
      'end',
    ].join('\n');

    const result = rubyParser.parse(code, 'server.rb');
    expect(result.declarations.length).toBe(1);
    const cls = result.declarations[0];
    expect(cls.name).toBe('Server');
    expect(cls.kind).toBe('ClassDef');
    expect(cls.children.length).toBe(2);

    const init = cls.children.find(c => c.name === 'initialize');
    expect(init?.kind).toBe('Constructor');

    const start = cls.children.find(c => c.name === 'start');
    expect(start?.kind).toBe('MethodDef');
  });

  test('extracts module', () => {
    const code = [
      'module Helpers',
      '  def format(str)',
      '    str.strip',
      '  end',
      'end',
    ].join('\n');

    const result = rubyParser.parse(code, 'helpers.rb');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('Helpers');
    expect(result.declarations[0].children.length).toBe(1);
  });

  test('extracts class method (self.name)', () => {
    const code = [
      'class Factory',
      '  def self.create(type)',
      '    new(type)',
      '  end',
      'end',
    ].join('\n');

    const result = rubyParser.parse(code, 'factory.rb');
    const cls = result.declarations[0];
    expect(cls.children.length).toBe(1);
    expect(cls.children[0].name).toBe('self.create');
  });

  test('extracts attr_accessor as properties', () => {
    const code = [
      'class User',
      '  attr_accessor :name, :email',
      '  attr_reader :id',
      '',
      '  def initialize(name, email)',
      '    @name = name',
      '    @email = email',
      '  end',
      'end',
    ].join('\n');

    const result = rubyParser.parse(code, 'user.rb');
    const cls = result.declarations[0];
    const props = cls.children.filter(c => c.kind === 'PropertyDef');
    expect(props.length).toBe(3);
    expect(props.map(p => p.name)).toEqual(['name', 'email', 'id']);
  });

  test('extracts constant', () => {
    const code = 'MAX_RETRIES = 3';
    const result = rubyParser.parse(code, 'config.rb');
    expect(result.declarations.length).toBe(1);
    expect(result.declarations[0].name).toBe('MAX_RETRIES');
    expect(result.declarations[0].kind).toBe('VariableDecl');
  });

  test('extracts predicate and bang methods', () => {
    const code = [
      'class Item',
      '  def valid?',
      '    true',
      '  end',
      '',
      '  def save!',
      '    persist',
      '  end',
      'end',
    ].join('\n');

    const result = rubyParser.parse(code, 'item.rb');
    const cls = result.declarations[0];
    expect(cls.children.map(c => c.name)).toEqual(['valid?', 'save!']);
  });
});

// ---------------------------------------------------------------------------
// Parse: imports
// ---------------------------------------------------------------------------

describe('rubyParser.parse — imports', () => {
  test('extracts require', () => {
    const code = "require 'json'";
    const result = rubyParser.parse(code, 'app.rb');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('json');
  });

  test('extracts require_relative', () => {
    const code = "require_relative 'helpers/format'";
    const result = rubyParser.parse(code, 'app.rb');
    expect(result.imports.length).toBe(1);
    expect(result.imports[0].source).toBe('helpers/format');
  });

  test('extracts include', () => {
    const code = [
      'class Server',
      '  include Loggable',
      'end',
    ].join('\n');

    const result = rubyParser.parse(code, 'server.rb');
    const inc = result.imports.find(i => i.source === 'Loggable');
    expect(inc).toBeDefined();
    expect(inc!.isNamespace).toBe(true);
  });

  test('extracts extend', () => {
    const code = [
      'class Config',
      '  extend ClassMethods',
      'end',
    ].join('\n');

    const result = rubyParser.parse(code, 'config.rb');
    const ext = result.imports.find(i => i.source === 'ClassMethods');
    expect(ext).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Parse: exports
// ---------------------------------------------------------------------------

describe('rubyParser.parse — exports', () => {
  test('extracts module_function', () => {
    const code = [
      'module Utils',
      '  module_function :helper',
      'end',
    ].join('\n');

    const result = rubyParser.parse(code, 'utils.rb');
    expect(result.exports.length).toBe(1);
    expect(result.exports[0].name).toBe('helper');
  });
});

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

describe('rubyParser.diff', () => {
  test('detects method addition', () => {
    const oldCode = [
      'def foo',
      '  1',
      'end',
    ].join('\n');
    const newCode = [
      'def foo',
      '  1',
      'end',
      '',
      'def bar',
      '  2',
      'end',
    ].join('\n');

    const patches = rubyParser.diff(
      rubyParser.parse(oldCode, 'app.rb'),
      rubyParser.parse(newCode, 'app.rb'),
    );

    const adds = patches.filter(p => p.kind === 'symbolAdd');
    expect(adds.length).toBe(1);
    if (adds[0].kind === 'symbolAdd') expect(adds[0].entity.name).toBe('bar');
  });

  test('detects method removal', () => {
    const oldCode = "def foo\n  1\nend\n\ndef bar\n  2\nend";
    const newCode = "def foo\n  1\nend";

    const patches = rubyParser.diff(
      rubyParser.parse(oldCode, 'app.rb'),
      rubyParser.parse(newCode, 'app.rb'),
    );

    const removes = patches.filter(p => p.kind === 'symbolRemove');
    expect(removes.length).toBe(1);
  });

  test('detects modification', () => {
    const oldCode = "def greet\n  'hello'\nend";
    const newCode = "def greet\n  'goodbye'\nend";

    const patches = rubyParser.diff(
      rubyParser.parse(oldCode, 'app.rb'),
      rubyParser.parse(newCode, 'app.rb'),
    );

    expect(patches.length).toBe(1);
    expect(patches[0].kind).toBe('symbolModify');
  });

  test('detects import addition', () => {
    const oldCode = "require 'json'\n\ndef main\nend";
    const newCode = "require 'json'\nrequire 'yaml'\n\ndef main\nend";

    const patches = rubyParser.diff(
      rubyParser.parse(oldCode, 'app.rb'),
      rubyParser.parse(newCode, 'app.rb'),
    );

    const importAdd = patches.find(p => p.kind === 'importAdd');
    expect(importAdd).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe('rubyParser — integration', () => {
  test('full Ruby file parses correctly', () => {
    const code = [
      "require 'net/http'",
      "require_relative 'config'",
      '',
      'class HttpClient',
      '  attr_reader :base_url',
      '',
      '  def initialize(base_url)',
      '    @base_url = base_url',
      '  end',
      '',
      '  def get(path)',
      '    Net::HTTP.get(URI("#{@base_url}#{path}"))',
      '  end',
      '',
      '  def self.default',
      '    new("https://api.example.com")',
      '  end',
      'end',
    ].join('\n');

    const result = rubyParser.parse(code, 'http_client.rb');
    expect(result.language).toBe('ruby');
    expect(result.imports.length).toBe(2);
    expect(result.declarations.length).toBe(1);

    const cls = result.declarations[0];
    expect(cls.name).toBe('HttpClient');
    expect(cls.children.length).toBe(4); // base_url prop + initialize + get + self.default
  });
});

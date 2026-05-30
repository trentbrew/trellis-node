/**
 * Ruby Parser Adapter
 *
 * Tier 1 regex-based parser for Ruby source files.
 * Extracts classes, modules, methods, constants, attributes,
 * require/include statements, and module_function exports.
 *
 * @see TRL-8
 */

import type {
  ParserAdapter,
  ParseResult,
  ASTEntity,
  ASTEntityKind,
  ImportRelation,
  ExportRelation,
  SemanticPatch,
} from './types.js';

// ---------------------------------------------------------------------------
// Parser Adapter
// ---------------------------------------------------------------------------

export const rubyParser: ParserAdapter = {
  languages: ['ruby'],

  parse(content: string, filePath: string): ParseResult {
    const fileEntityId = `file:${filePath}`;

    return {
      fileEntityId,
      filePath,
      language: 'ruby',
      declarations: extractDeclarations(content, filePath),
      imports: extractImports(content),
      exports: extractExports(content),
    };
  },

  diff(oldResult: ParseResult, newResult: ParseResult): SemanticPatch[] {
    return computeSemanticDiff(oldResult, newResult);
  },
};

// ---------------------------------------------------------------------------
// Declaration extraction
// ---------------------------------------------------------------------------

function extractDeclarations(content: string, filePath: string): ASTEntity[] {
  const declarations: ASTEntity[] = [];
  const lines = content.split('\n');
  const scopeStack: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines, comments
    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    // Class: class Name [< Parent]
    let match = trimmed.match(/^class\s+([A-Z]\w*(?:::\w+)*)/);
    if (match) {
      const name = match[1];
      scopeStack.push(name);
      const result = extractEndBlock(name, 'ClassDef', lines, i, filePath, scopeStack);
      result.entity.children = extractClassMembers(lines, i, result.endLine, name, filePath);
      declarations.push(result.entity);
      scopeStack.pop();
      i = result.endLine + 1;
      continue;
    }

    // Module: module Name
    match = trimmed.match(/^module\s+([A-Z]\w*(?:::\w+)*)/);
    if (match) {
      const name = match[1];
      scopeStack.push(name);
      const result = extractEndBlock(name, 'ClassDef', lines, i, filePath, scopeStack);
      result.entity.children = extractClassMembers(lines, i, result.endLine, name, filePath);
      declarations.push(result.entity);
      scopeStack.pop();
      i = result.endLine + 1;
      continue;
    }

    // Top-level method: def name or def self.name
    match = trimmed.match(/^def\s+(self\.)?(\w+[?!=]?)/);
    if (match) {
      const name = match[1] ? `self.${match[2]}` : match[2];
      const result = extractEndBlock(name, 'FunctionDef', lines, i, filePath, scopeStack);
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Constant: NAME = value (top-level, all caps or CamelCase starting with uppercase)
    match = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=/);
    if (match) {
      declarations.push({
        id: makeEntityId(filePath, 'VariableDecl', match[1]),
        kind: 'VariableDecl',
        name: match[1],
        scopePath: match[1],
        span: [0, 0],
        rawText: trimmed,
        signature: normalizeSignature(trimmed),
        children: [],
      });
      i++;
      continue;
    }

    i++;
  }

  return declarations;
}

// ---------------------------------------------------------------------------
// Block extraction
// ---------------------------------------------------------------------------

interface ExtractionResult {
  entity: ASTEntity;
  endLine: number;
}

function extractEndBlock(
  name: string,
  kind: ASTEntityKind,
  lines: string[],
  startLine: number,
  filePath: string,
  scopeStack: string[],
): ExtractionResult {
  let depth = 0;
  let endLine = startLine;

  for (let i = startLine; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Count block openers
    if (isBlockOpener(trimmed)) depth++;
    // Count block closers
    if (trimmed === 'end' || trimmed.startsWith('end ') || trimmed.startsWith('end#')) depth--;

    if (depth <= 0 && i > startLine) { endLine = i; break; }
    endLine = i;
  }

  const rawText = lines.slice(startLine, endLine + 1).join('\n');
  const startOffset = lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);

  return {
    entity: {
      id: makeEntityId(filePath, kind, name),
      kind,
      name,
      scopePath: name,
      span: [startOffset, startOffset + rawText.length],
      rawText,
      signature: normalizeSignature(rawText),
      children: [],
    },
    endLine,
  };
}

function isBlockOpener(trimmed: string): boolean {
  // Match: class, module, def, do, if/unless/while/until/for/case/begin (as statements, not modifiers)
  if (/^(class|module|def|do|begin|case)\b/.test(trimmed)) return true;
  if (/^(if|unless|while|until|for)\b/.test(trimmed) && !trimmed.includes(' then ')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Class member extraction
// ---------------------------------------------------------------------------

function extractClassMembers(
  lines: string[],
  startLine: number,
  endLine: number,
  parentName: string,
  filePath: string,
): ASTEntity[] {
  const children: ASTEntity[] = [];
  let depth = 0;

  for (let i = startLine; i <= endLine; i++) {
    const trimmed = lines[i].trim();
    const depthBefore = depth;

    if (isBlockOpener(trimmed)) depth++;
    if (trimmed === 'end' || trimmed.startsWith('end ') || trimmed.startsWith('end#')) depth--;

    // Only look at depth 1 (direct children)
    if (depthBefore === 1) {
      // Method: def name or def self.name
      const match = trimmed.match(/^def\s+(self\.)?(\w+[?!=]?)/);
      if (match) {
        const methodName = match[1] ? `self.${match[2]}` : match[2];
        const kind: ASTEntityKind = methodName === 'initialize' ? 'Constructor' : 'MethodDef';
        children.push({
          id: makeEntityId(filePath, kind, `${parentName}.${methodName}`),
          kind,
          name: methodName,
          scopePath: `${parentName}.${methodName}`,
          span: [0, 0],
          rawText: trimmed,
          signature: normalizeSignature(trimmed),
          children: [],
        });
      }

      // attr_accessor / attr_reader / attr_writer
      const attrMatch = trimmed.match(/^attr_(accessor|reader|writer)\s+(.*)/);
      if (attrMatch) {
        const attrs = attrMatch[2].split(',').map(a => a.trim().replace(/^:/, ''));
        for (const attr of attrs) {
          if (attr) {
            children.push({
              id: makeEntityId(filePath, 'PropertyDef', `${parentName}.${attr}`),
              kind: 'PropertyDef',
              name: attr,
              scopePath: `${parentName}.${attr}`,
              span: [0, 0],
              rawText: trimmed,
              signature: normalizeSignature(trimmed),
              children: [],
            });
          }
        }
      }
    }
  }
  return children;
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

function extractImports(content: string): ImportRelation[] {
  const imports: ImportRelation[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // require 'name' or require "name"
    let match = trimmed.match(/^require\s+['"]([^'"]+)['"]/);
    if (match) {
      imports.push({
        source: match[1],
        specifiers: [match[1].split('/').pop()!],
        isDefault: true,
        isNamespace: false,
        rawText: trimmed,
        span: [0, trimmed.length],
      });
      continue;
    }

    // require_relative 'name'
    match = trimmed.match(/^require_relative\s+['"]([^'"]+)['"]/);
    if (match) {
      imports.push({
        source: match[1],
        specifiers: [match[1].split('/').pop()!],
        isDefault: true,
        isNamespace: false,
        rawText: trimmed,
        span: [0, trimmed.length],
      });
      continue;
    }

    // include ModuleName / extend ModuleName / prepend ModuleName
    match = trimmed.match(/^(include|extend|prepend)\s+([A-Z]\w*(?:::\w+)*)/);
    if (match) {
      imports.push({
        source: match[2],
        specifiers: [match[2]],
        isDefault: false,
        isNamespace: true,
        rawText: trimmed,
        span: [0, trimmed.length],
      });
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

function extractExports(content: string): ExportRelation[] {
  const exports: ExportRelation[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // module_function :name
    const match = trimmed.match(/^module_function\s+:(\w+)/);
    if (match) {
      exports.push({
        name: match[1],
        isDefault: false,
        rawText: trimmed,
        span: [0, 0],
      });
    }

    // public :name  (explicit public declaration)
    const pubMatch = trimmed.match(/^public\s+:(\w+)/);
    if (pubMatch) {
      exports.push({
        name: pubMatch[1],
        isDefault: false,
        rawText: trimmed,
        span: [0, 0],
      });
    }
  }

  return exports;
}

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

function computeSemanticDiff(
  oldResult: ParseResult,
  newResult: ParseResult,
): SemanticPatch[] {
  const patches: SemanticPatch[] = [];
  const fileId = newResult.fileEntityId;

  const oldDecls = new Map(oldResult.declarations.map(d => [d.id, d]));
  const newDecls = new Map(newResult.declarations.map(d => [d.id, d]));

  for (const [id, entity] of newDecls) {
    if (!oldDecls.has(id)) {
      const oldEntity = findRenamedEntity(entity, oldResult.declarations, newDecls);
      if (oldEntity) {
        patches.push({ kind: 'symbolRename', entityId: oldEntity.id, oldName: oldEntity.name, newName: entity.name });
      } else {
        patches.push({ kind: 'symbolAdd', entity });
      }
    }
  }

  for (const [id, entity] of oldDecls) {
    if (!newDecls.has(id)) {
      const wasRenamed = findRenamedEntity(entity, newResult.declarations, oldDecls);
      if (!wasRenamed) {
        patches.push({ kind: 'symbolRemove', entityId: id, entityName: entity.name });
      }
    }
  }

  for (const [id, newEntity] of newDecls) {
    const oldEntity = oldDecls.get(id);
    if (oldEntity && oldEntity.signature !== newEntity.signature) {
      patches.push({
        kind: 'symbolModify', entityId: id, entityName: newEntity.name,
        oldSignature: oldEntity.signature, newSignature: newEntity.signature,
        oldRawText: oldEntity.rawText, newRawText: newEntity.rawText,
      });
    }
  }

  const oldImports = new Map(oldResult.imports.map(imp => [imp.source, imp]));
  const newImports = new Map(newResult.imports.map(imp => [imp.source, imp]));

  for (const [source, imp] of newImports) {
    const oldImp = oldImports.get(source);
    if (!oldImp) {
      patches.push({ kind: 'importAdd', fileId, source, specifiers: imp.specifiers, rawText: imp.rawText });
    } else if (JSON.stringify(oldImp.specifiers.sort()) !== JSON.stringify(imp.specifiers.sort())) {
      patches.push({ kind: 'importModify', fileId, source, oldSpecifiers: oldImp.specifiers, newSpecifiers: imp.specifiers });
    }
  }
  for (const [source] of oldImports) {
    if (!newImports.has(source)) {
      patches.push({ kind: 'importRemove', fileId, source });
    }
  }

  const oldExports = new Map(oldResult.exports.map(exp => [exp.name, exp]));
  const newExports = new Map(newResult.exports.map(exp => [exp.name, exp]));
  for (const [name, exp] of newExports) {
    if (!oldExports.has(name)) {
      patches.push({ kind: 'exportAdd', fileId, name, rawText: exp.rawText });
    }
  }
  for (const [name] of oldExports) {
    if (!newExports.has(name)) {
      patches.push({ kind: 'exportRemove', fileId, name });
    }
  }

  return patches;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findRenamedEntity(
  entity: ASTEntity,
  candidates: ASTEntity[],
  existingIds: Map<string, ASTEntity>,
): ASTEntity | null {
  for (const candidate of candidates) {
    if (candidate.kind !== entity.kind) continue;
    if (candidate.name === entity.name) continue;
    if (existingIds.has(candidate.id)) continue;
    const normalizedOld = candidate.signature.replace(new RegExp(candidate.name, 'g'), '___');
    const normalizedNew = entity.signature.replace(new RegExp(entity.name, 'g'), '___');
    if (normalizedOld === normalizedNew) return candidate;
  }
  return null;
}

function makeEntityId(filePath: string, kind: string, name: string): string {
  return `${kind}:${filePath}:${name}`;
}

function normalizeSignature(text: string): string {
  return text
    .replace(/#[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

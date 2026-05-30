/**
 * Go Parser Adapter
 *
 * Tier 1 regex-based parser for Go source files.
 * Extracts structs, interfaces, functions, methods, type aliases,
 * constants, variables, and imports.
 *
 * @see TRL-6
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

export const goParser: ParserAdapter = {
  languages: ['go'],

  parse(content: string, filePath: string): ParseResult {
    const fileEntityId = `file:${filePath}`;

    return {
      fileEntityId,
      filePath,
      language: 'go',
      declarations: extractDeclarations(content, filePath),
      imports: extractImports(content),
      exports: extractExports(content, filePath),
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

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines, comments, package declaration
    if (
      !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('package ') ||
      trimmed.startsWith('import ')
    ) {
      i++;
      continue;
    }

    // Skip import blocks
    if (trimmed === 'import (') {
      while (i < lines.length && !lines[i].trim().startsWith(')')) { i++; }
      i++;
      continue;
    }

    // Function declaration: func Name(...)
    let match = trimmed.match(/^func\s+(\w+)\s*\(/);
    if (match) {
      const result = extractBraceBlock(match[1], 'FunctionDef', lines, i, filePath);
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Method declaration: func (receiver) Name(...)
    match = trimmed.match(/^func\s+\([^)]+\)\s+(\w+)\s*\(/);
    if (match) {
      const result = extractBraceBlock(match[1], 'MethodDef', lines, i, filePath);
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Type struct: type Name struct {
    match = trimmed.match(/^type\s+(\w+)\s+struct\b/);
    if (match) {
      const result = extractBraceBlock(match[1], 'ClassDef', lines, i, filePath);
      result.entity.children = extractStructFields(lines, i, result.endLine, match[1], filePath);
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Type interface: type Name interface {
    match = trimmed.match(/^type\s+(\w+)\s+interface\b/);
    if (match) {
      const result = extractBraceBlock(match[1], 'InterfaceDef', lines, i, filePath);
      result.entity.children = extractInterfaceMethods(lines, i, result.endLine, match[1], filePath);
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Type alias: type Name = ... or type Name OtherType
    match = trimmed.match(/^type\s+(\w+)\s+/);
    if (match) {
      const result = extractSingleOrBlock(match[1], 'TypeAlias', lines, i, filePath);
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Const block or single: const ( ... ) or const Name = ...
    if (trimmed.startsWith('const ') || trimmed === 'const (') {
      if (trimmed === 'const (') {
        // Block const
        const endLine = findClosingParen(lines, i);
        const rawText = lines.slice(i, endLine + 1).join('\n');
        const consts = extractConstBlock(lines, i, endLine, filePath);
        declarations.push(...consts);
        i = endLine + 1;
      } else {
        match = trimmed.match(/^const\s+(\w+)/);
        if (match) {
          const result = extractSingleLine(match[1], 'VariableDecl', lines, i, filePath);
          declarations.push(result.entity);
          i = result.endLine + 1;
        } else {
          i++;
        }
      }
      continue;
    }

    // Var block or single
    if (trimmed.startsWith('var ') || trimmed === 'var (') {
      if (trimmed === 'var (') {
        const endLine = findClosingParen(lines, i);
        const vars = extractVarBlock(lines, i, endLine, filePath);
        declarations.push(...vars);
        i = endLine + 1;
      } else {
        match = trimmed.match(/^var\s+(\w+)/);
        if (match) {
          const result = extractSingleLine(match[1], 'VariableDecl', lines, i, filePath);
          declarations.push(result.entity);
          i = result.endLine + 1;
        } else {
          i++;
        }
      }
      continue;
    }

    i++;
  }

  return declarations;
}

// ---------------------------------------------------------------------------
// Block extraction helpers
// ---------------------------------------------------------------------------

interface ExtractionResult {
  entity: ASTEntity;
  endLine: number;
}

function extractBraceBlock(
  name: string,
  kind: ASTEntityKind,
  lines: string[],
  startLine: number,
  filePath: string,
): ExtractionResult {
  let depth = 0;
  let foundOpen = false;
  let endLine = startLine;

  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; foundOpen = true; }
      else if (ch === '}') { depth--; }
    }
    if (foundOpen && depth <= 0) { endLine = i; break; }
    if (i > startLine + 200) { endLine = i; break; }
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

function extractSingleOrBlock(
  name: string,
  kind: ASTEntityKind,
  lines: string[],
  startLine: number,
  filePath: string,
): ExtractionResult {
  const trimmed = lines[startLine].trim();
  if (trimmed.includes('{')) {
    return extractBraceBlock(name, kind, lines, startLine, filePath);
  }
  return extractSingleLine(name, kind, lines, startLine, filePath);
}

function extractSingleLine(
  name: string,
  kind: ASTEntityKind,
  lines: string[],
  startLine: number,
  filePath: string,
): ExtractionResult {
  const rawText = lines[startLine];
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
    endLine: startLine,
  };
}

function findClosingParen(lines: string[], startLine: number): number {
  for (let i = startLine + 1; i < lines.length; i++) {
    if (lines[i].trim() === ')') return i;
  }
  return lines.length - 1;
}

// ---------------------------------------------------------------------------
// Struct field + interface method extraction
// ---------------------------------------------------------------------------

function extractStructFields(
  lines: string[],
  startLine: number,
  endLine: number,
  structName: string,
  filePath: string,
): ASTEntity[] {
  const children: ASTEntity[] = [];
  for (let i = startLine + 1; i < endLine; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed === '{' || trimmed === '}') continue;

    const match = trimmed.match(/^(\w+)\s+/);
    if (match) {
      children.push({
        id: makeEntityId(filePath, 'PropertyDef', `${structName}.${match[1]}`),
        kind: 'PropertyDef',
        name: match[1],
        scopePath: `${structName}.${match[1]}`,
        span: [0, 0],
        rawText: trimmed,
        signature: normalizeSignature(trimmed),
        children: [],
      });
    }
  }
  return children;
}

function extractInterfaceMethods(
  lines: string[],
  startLine: number,
  endLine: number,
  ifaceName: string,
  filePath: string,
): ASTEntity[] {
  const children: ASTEntity[] = [];
  for (let i = startLine + 1; i < endLine; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed === '{' || trimmed === '}') continue;

    const match = trimmed.match(/^(\w+)\s*\(/);
    if (match) {
      children.push({
        id: makeEntityId(filePath, 'MethodDef', `${ifaceName}.${match[1]}`),
        kind: 'MethodDef',
        name: match[1],
        scopePath: `${ifaceName}.${match[1]}`,
        span: [0, 0],
        rawText: trimmed,
        signature: normalizeSignature(trimmed),
        children: [],
      });
    }
  }
  return children;
}

// ---------------------------------------------------------------------------
// Const/var block extraction
// ---------------------------------------------------------------------------

function extractConstBlock(
  lines: string[],
  startLine: number,
  endLine: number,
  filePath: string,
): ASTEntity[] {
  const entities: ASTEntity[] = [];
  for (let i = startLine + 1; i < endLine; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const match = trimmed.match(/^(\w+)/);
    if (match) {
      entities.push({
        id: makeEntityId(filePath, 'VariableDecl', match[1]),
        kind: 'VariableDecl',
        name: match[1],
        scopePath: match[1],
        span: [0, 0],
        rawText: trimmed,
        signature: normalizeSignature(trimmed),
        children: [],
      });
    }
  }
  return entities;
}

function extractVarBlock(
  lines: string[],
  startLine: number,
  endLine: number,
  filePath: string,
): ASTEntity[] {
  return extractConstBlock(lines, startLine, endLine, filePath);
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

function extractImports(content: string): ImportRelation[] {
  const imports: ImportRelation[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Single import: import "fmt"
    let match = trimmed.match(/^import\s+"([^"]+)"/);
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

    // Import block: import ( ... )
    if (trimmed === 'import (') {
      for (let j = i + 1; j < lines.length; j++) {
        const impLine = lines[j].trim();
        if (impLine === ')') { i = j; break; }
        if (!impLine || impLine.startsWith('//')) continue;

        // Aliased: alias "path"
        const aliasMatch = impLine.match(/^(\w+)\s+"([^"]+)"/);
        if (aliasMatch) {
          imports.push({
            source: aliasMatch[2],
            specifiers: [aliasMatch[1]],
            isDefault: true,
            isNamespace: false,
            rawText: impLine,
            span: [0, impLine.length],
          });
          continue;
        }

        // Dot import: . "path"
        const dotMatch = impLine.match(/^\.\s+"([^"]+)"/);
        if (dotMatch) {
          imports.push({
            source: dotMatch[1],
            specifiers: ['*'],
            isDefault: false,
            isNamespace: true,
            rawText: impLine,
            span: [0, impLine.length],
          });
          continue;
        }

        // Standard: "path"
        const stdMatch = impLine.match(/^"([^"]+)"/);
        if (stdMatch) {
          imports.push({
            source: stdMatch[1],
            specifiers: [stdMatch[1].split('/').pop()!],
            isDefault: true,
            isNamespace: false,
            rawText: impLine,
            span: [0, impLine.length],
          });
        }
      }
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

/**
 * In Go, exported names start with an uppercase letter.
 * We derive exports from declarations.
 */
function extractExports(content: string, filePath: string): ExportRelation[] {
  const exports: ExportRelation[] = [];
  const decls = extractDeclarations(content, filePath);

  for (const d of decls) {
    if (d.name[0] >= 'A' && d.name[0] <= 'Z') {
      exports.push({
        name: d.name,
        isDefault: false,
        rawText: d.rawText.split('\n')[0],
        span: d.span,
      });
    }
  }

  return exports;
}

// ---------------------------------------------------------------------------
// Semantic diff (same generic algorithm)
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
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

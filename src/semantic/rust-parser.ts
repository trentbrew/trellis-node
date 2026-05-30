/**
 * Rust Parser Adapter
 *
 * Tier 1 regex-based parser for Rust source files.
 * Extracts structs, enums, traits, impl blocks, functions,
 * methods, type aliases, constants, macros, and use statements.
 *
 * @see TRL-7
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

export const rustParser: ParserAdapter = {
  languages: ['rust'],

  parse(content: string, filePath: string): ParseResult {
    const fileEntityId = `file:${filePath}`;

    return {
      fileEntityId,
      filePath,
      language: 'rust',
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

    // Skip empty, comments, use statements, attributes (handled with next decl)
    if (
      !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('use ') ||
      trimmed.startsWith('extern ') ||
      trimmed.startsWith('mod ') ||
      trimmed.startsWith('#![')
    ) {
      i++;
      continue;
    }

    // Collect attributes (#[...])
    const attrs: string[] = [];
    const attrStart = i;
    while (i < lines.length && lines[i].trim().startsWith('#[')) {
      attrs.push(lines[i].trim());
      i++;
    }
    if (i >= lines.length) break;

    const declLine = lines[i].trim();

    // Strip visibility + qualifiers for matching
    const stripped = declLine
      .replace(/^pub(\s*\([^)]*\))?\s+/, '')
      .replace(/^async\s+/, '')
      .replace(/^unsafe\s+/, '')
      .replace(/^const\s+(?=fn)/, '');

    // Struct: struct Name { ... } or struct Name;
    let match = stripped.match(/^struct\s+(\w+)/);
    if (match) {
      if (declLine.includes(';') && !declLine.includes('{')) {
        // Unit struct or tuple struct without brace block on this line
        const result = extractToSemicolon(
          match[1],
          'ClassDef',
          lines,
          attrs.length > 0 ? attrStart : i,
          i,
          filePath,
          attrs,
        );
        declarations.push(result.entity);
        i = result.endLine + 1;
      } else {
        const result = extractBraceBlock(
          match[1],
          'ClassDef',
          lines,
          attrs.length > 0 ? attrStart : i,
          i,
          filePath,
          attrs,
        );
        result.entity.children = extractStructFields(
          lines,
          i,
          result.endLine,
          match[1],
          filePath,
        );
        declarations.push(result.entity);
        i = result.endLine + 1;
      }
      continue;
    }

    // Enum: enum Name { ... }
    match = stripped.match(/^enum\s+(\w+)/);
    if (match) {
      const result = extractBraceBlock(
        match[1],
        'EnumDef',
        lines,
        attrs.length > 0 ? attrStart : i,
        i,
        filePath,
        attrs,
      );
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Trait: trait Name { ... }
    match = stripped.match(/^trait\s+(\w+)/);
    if (match) {
      const result = extractBraceBlock(
        match[1],
        'InterfaceDef',
        lines,
        attrs.length > 0 ? attrStart : i,
        i,
        filePath,
        attrs,
      );
      result.entity.children = extractTraitMethods(
        lines,
        i,
        result.endLine,
        match[1],
        filePath,
      );
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Impl block: impl [Trait for] Type { ... }
    match = stripped.match(/^impl(?:<[^>]*>)?\s+(?:(\w+)\s+for\s+)?(\w+)/);
    if (match && stripped.includes('{')) {
      const typeName = match[2];
      const traitName = match[1];
      const implName = traitName ? `${traitName} for ${typeName}` : typeName;
      const result = extractBraceBlock(
        implName,
        'ClassDef',
        lines,
        attrs.length > 0 ? attrStart : i,
        i,
        filePath,
        attrs,
      );
      result.entity.children = extractImplMethods(
        lines,
        i,
        result.endLine,
        implName,
        filePath,
      );
      result.entity.id = makeEntityId(filePath, 'ClassDef', `impl:${implName}`);
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Async function: async fn name(...)
    match = stripped.match(/^fn\s+(\w+)/);
    if (match) {
      const result = extractBraceBlock(
        match[1],
        'FunctionDef',
        lines,
        attrs.length > 0 ? attrStart : i,
        i,
        filePath,
        attrs,
      );
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Type alias: type Name = ...;
    match = stripped.match(/^type\s+(\w+)/);
    if (match) {
      const result = extractToSemicolon(
        match[1],
        'TypeAlias',
        lines,
        attrs.length > 0 ? attrStart : i,
        i,
        filePath,
        attrs,
      );
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Const: const NAME: Type = ...;
    match = stripped.match(/^const\s+(\w+)/);
    if (match) {
      const result = extractToSemicolon(
        match[1],
        'VariableDecl',
        lines,
        attrs.length > 0 ? attrStart : i,
        i,
        filePath,
        attrs,
      );
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Static: static [mut] NAME: Type = ...;
    match = stripped.match(/^static\s+(?:mut\s+)?(\w+)/);
    if (match) {
      const result = extractToSemicolon(
        match[1],
        'VariableDecl',
        lines,
        attrs.length > 0 ? attrStart : i,
        i,
        filePath,
        attrs,
      );
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Macro: macro_rules! name { ... }
    match = stripped.match(/^macro_rules!\s+(\w+)/);
    if (match) {
      const result = extractBraceBlock(
        match[1],
        'FunctionDef',
        lines,
        attrs.length > 0 ? attrStart : i,
        i,
        filePath,
        attrs,
      );
      result.entity.id = makeEntityId(
        filePath,
        'FunctionDef',
        `macro:${match[1]}`,
      );
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // If we collected attributes but no matching decl, skip
    if (attrs.length > 0) {
      i++;
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
  defLine: number,
  filePath: string,
  attrs: string[],
): ExtractionResult {
  let depth = 0;
  let foundOpen = false;
  let endLine = defLine;

  for (let i = defLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth++;
        foundOpen = true;
      } else if (ch === '}') {
        depth--;
      }
    }
    if (foundOpen && depth <= 0) {
      endLine = i;
      break;
    }
    if (i > defLine + 300) {
      endLine = i;
      break;
    }
    endLine = i;
  }

  const rawText = lines.slice(startLine, endLine + 1).join('\n');
  const startOffset =
    lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);

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

function extractToSemicolon(
  name: string,
  kind: ASTEntityKind,
  lines: string[],
  startLine: number,
  defLine: number,
  filePath: string,
  attrs: string[],
): ExtractionResult {
  let endLine = defLine;
  for (let i = defLine; i < lines.length; i++) {
    if (lines[i].includes(';')) {
      endLine = i;
      break;
    }
    endLine = i;
  }

  const rawText = lines.slice(startLine, endLine + 1).join('\n');
  const startOffset =
    lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);

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

// ---------------------------------------------------------------------------
// Member extraction
// ---------------------------------------------------------------------------

function extractStructFields(
  lines: string[],
  startLine: number,
  endLine: number,
  structName: string,
  filePath: string,
): ASTEntity[] {
  const children: ASTEntity[] = [];
  let inBody = false;

  for (let i = startLine; i <= endLine; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.includes('{')) {
      inBody = true;
      continue;
    }
    if (!inBody) continue;
    if (trimmed === '}' || !trimmed || trimmed.startsWith('//')) continue;

    const match = trimmed.match(/^(?:pub\s+)?(\w+)\s*:/);
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

function extractTraitMethods(
  lines: string[],
  startLine: number,
  endLine: number,
  traitName: string,
  filePath: string,
): ASTEntity[] {
  return extractBlockMethods(lines, startLine, endLine, traitName, filePath);
}

function extractImplMethods(
  lines: string[],
  startLine: number,
  endLine: number,
  implName: string,
  filePath: string,
): ASTEntity[] {
  return extractBlockMethods(lines, startLine, endLine, implName, filePath);
}

function extractBlockMethods(
  lines: string[],
  startLine: number,
  endLine: number,
  parentName: string,
  filePath: string,
): ASTEntity[] {
  const children: ASTEntity[] = [];
  let depth = 0;

  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i];
    const depthBefore = depth;

    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }

    // A direct child line starts at depth 1 (inside the block, not nested deeper)
    if (depthBefore === 1) {
      const trimmed = line
        .trim()
        .replace(/^pub(\s*\([^)]*\))?\s+/, '')
        .replace(/^async\s+/, '')
        .replace(/^unsafe\s+/, '')
        .replace(/^const\s+(?=fn)/, '');

      const match = trimmed.match(/^fn\s+(\w+)/);
      if (match) {
        const kind: ASTEntityKind =
          match[1] === 'new' ? 'Constructor' : 'MethodDef';
        children.push({
          id: makeEntityId(filePath, kind, `${parentName}.${match[1]}`),
          kind,
          name: match[1],
          scopePath: `${parentName}.${match[1]}`,
          span: [0, 0],
          rawText: line.trim(),
          signature: normalizeSignature(line.trim()),
          children: [],
        });
      }
    }
  }
  return children;
}

// ---------------------------------------------------------------------------
// Import extraction (use statements)
// ---------------------------------------------------------------------------

function extractImports(content: string): ImportRelation[] {
  const imports: ImportRelation[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('use ') && !trimmed.startsWith('pub use '))
      continue;

    let full = trimmed;
    // Handle multi-line use
    while (!full.includes(';') && i + 1 < lines.length) {
      i++;
      full += ' ' + lines[i].trim();
    }

    const cleaned = full
      .replace(/^pub\s+/, '')
      .replace(/^use\s+/, '')
      .replace(/;$/, '')
      .trim();

    // use crate::module::{A, B, C};
    const braceMatch = cleaned.match(/^(.+)::\{([^}]+)\}$/);
    if (braceMatch) {
      const source = braceMatch[1];
      const specifiers = braceMatch[2]
        .split(',')
        .map((s) =>
          s
            .trim()
            .split('::')
            .pop()!
            .replace(/\s+as\s+\w+/, ''),
        )
        .filter(Boolean);
      imports.push({
        source,
        specifiers,
        isDefault: false,
        isNamespace: false,
        rawText: full,
        span: [0, full.length],
      });
      continue;
    }

    // use crate::module::Name;  or  use crate::module::*;
    const simpleMatch = cleaned.match(/^(.+)::(\w+|\*)$/);
    if (simpleMatch) {
      const isWild = simpleMatch[2] === '*';
      imports.push({
        source: cleaned,
        specifiers: [simpleMatch[2]],
        isDefault: !isWild,
        isNamespace: isWild,
        rawText: full,
        span: [0, full.length],
      });
      continue;
    }

    // use module as alias;
    const aliasMatch = cleaned.match(/^(\S+)\s+as\s+(\w+)$/);
    if (aliasMatch) {
      imports.push({
        source: aliasMatch[1],
        specifiers: [aliasMatch[2]],
        isDefault: true,
        isNamespace: false,
        rawText: full,
        span: [0, full.length],
      });
      continue;
    }

    // Fallback: treat whole path as source
    imports.push({
      source: cleaned,
      specifiers: [cleaned.split('::').pop() ?? cleaned],
      isDefault: true,
      isNamespace: false,
      rawText: full,
      span: [0, full.length],
    });
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

/**
 * In Rust, `pub` items are exports. We derive from declarations.
 */
function extractExports(content: string, filePath: string): ExportRelation[] {
  const exports: ExportRelation[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('pub ') && !trimmed.startsWith('pub(')) continue;

    // pub fn name, pub struct name, pub enum name, pub trait name, pub type name, pub const name
    const match = trimmed.match(
      /^pub(?:\s*\([^)]*\))?\s+(?:async\s+|unsafe\s+|const\s+)?(?:fn|struct|enum|trait|type|const|static)\s+(\w+)/,
    );
    if (match) {
      exports.push({
        name: match[1],
        isDefault: false,
        rawText: trimmed.split('{')[0].trim(),
        span: [0, 0],
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

  const oldDecls = new Map(oldResult.declarations.map((d) => [d.id, d]));
  const newDecls = new Map(newResult.declarations.map((d) => [d.id, d]));

  for (const [id, entity] of newDecls) {
    if (!oldDecls.has(id)) {
      const oldEntity = findRenamedEntity(
        entity,
        oldResult.declarations,
        newDecls,
      );
      if (oldEntity) {
        patches.push({
          kind: 'symbolRename',
          entityId: oldEntity.id,
          oldName: oldEntity.name,
          newName: entity.name,
        });
      } else {
        patches.push({ kind: 'symbolAdd', entity });
      }
    }
  }

  for (const [id, entity] of oldDecls) {
    if (!newDecls.has(id)) {
      const wasRenamed = findRenamedEntity(
        entity,
        newResult.declarations,
        oldDecls,
      );
      if (!wasRenamed) {
        patches.push({
          kind: 'symbolRemove',
          entityId: id,
          entityName: entity.name,
        });
      }
    }
  }

  for (const [id, newEntity] of newDecls) {
    const oldEntity = oldDecls.get(id);
    if (oldEntity && oldEntity.signature !== newEntity.signature) {
      patches.push({
        kind: 'symbolModify',
        entityId: id,
        entityName: newEntity.name,
        oldSignature: oldEntity.signature,
        newSignature: newEntity.signature,
        oldRawText: oldEntity.rawText,
        newRawText: newEntity.rawText,
      });
    }
  }

  const oldImports = new Map(oldResult.imports.map((imp) => [imp.source, imp]));
  const newImports = new Map(newResult.imports.map((imp) => [imp.source, imp]));

  for (const [source, imp] of newImports) {
    const oldImp = oldImports.get(source);
    if (!oldImp) {
      patches.push({
        kind: 'importAdd',
        fileId,
        source,
        specifiers: imp.specifiers,
        rawText: imp.rawText,
      });
    } else if (
      JSON.stringify(oldImp.specifiers.sort()) !==
      JSON.stringify(imp.specifiers.sort())
    ) {
      patches.push({
        kind: 'importModify',
        fileId,
        source,
        oldSpecifiers: oldImp.specifiers,
        newSpecifiers: imp.specifiers,
      });
    }
  }
  for (const [source] of oldImports) {
    if (!newImports.has(source)) {
      patches.push({ kind: 'importRemove', fileId, source });
    }
  }

  const oldExports = new Map(oldResult.exports.map((exp) => [exp.name, exp]));
  const newExports = new Map(newResult.exports.map((exp) => [exp.name, exp]));
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
    const normalizedOld = candidate.signature.replace(
      new RegExp(candidate.name, 'g'),
      '___',
    );
    const normalizedNew = entity.signature.replace(
      new RegExp(entity.name, 'g'),
      '___',
    );
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

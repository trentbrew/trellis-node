/**
 * C# Parser Adapter
 *
 * Tier 1 regex-based parser for C# source files.
 * Extracts classes, interfaces, structs, enums, records,
 * methods, properties, fields, using directives, and namespace exports.
 *
 * @see TRL-10
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

export const csharpParser: ParserAdapter = {
  languages: ['csharp'],

  parse(content: string, filePath: string): ParseResult {
    const fileEntityId = `file:${filePath}`;

    return {
      fileEntityId,
      filePath,
      language: 'csharp',
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

const MODIFIERS_RE = /(?:(?:public|private|protected|internal|static|abstract|sealed|virtual|override|partial|readonly|async|extern|unsafe|volatile|new)\s+)*/;
const TYPE_DEF_RE = new RegExp(`^${MODIFIERS_RE.source}(class|interface|struct|enum|record)\\s+(\\w+)`);
const METHOD_RE = new RegExp(`^${MODIFIERS_RE.source}(?:\\w[\\w<>\\[\\],\\s?]*?)\\s+(\\w+)\\s*[(<]`);
const PROP_RE = new RegExp(`^${MODIFIERS_RE.source}(?:\\w[\\w<>\\[\\],\\s?]*?)\\s+(\\w+)\\s*\\{`);
const FIELD_RE = new RegExp(`^${MODIFIERS_RE.source}(?:\\w[\\w<>\\[\\],\\s?]*?)\\s+(\\w+)\\s*[;=]`);

function extractDeclarations(content: string, filePath: string): ASTEntity[] {
  const declarations: ASTEntity[] = [];
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Skip empty, comments, using, namespace
    if (
      !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('using ') ||
      trimmed.startsWith('namespace ')
    ) {
      i++;
      continue;
    }

    // Collect attributes
    const attributes: string[] = [];
    const attrStart = i;
    while (i < lines.length && lines[i].trim().startsWith('[')) {
      attributes.push(lines[i].trim());
      i++;
    }
    if (i >= lines.length) break;

    const declLine = lines[i].trim();

    // Class/Interface/Struct/Enum/Record
    const typeMatch = declLine.match(TYPE_DEF_RE);
    if (typeMatch) {
      const typeKind = typeMatch[1];
      const name = typeMatch[2];
      const kind: ASTEntityKind =
        typeKind === 'interface' ? 'InterfaceDef' :
        typeKind === 'enum' ? 'EnumDef' :
        'ClassDef';
      const result = extractBraceBlock(
        name, kind, lines,
        attributes.length > 0 ? attrStart : i,
        i, filePath,
      );
      result.entity.children = extractTypeMembers(lines, i, result.endLine, name, filePath);
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // If attributes collected but no match, skip
    if (attributes.length > 0) {
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

function extractBraceBlock(
  name: string,
  kind: ASTEntityKind,
  lines: string[],
  startLine: number,
  defLine: number,
  filePath: string,
): ExtractionResult {
  let depth = 0;
  let foundOpen = false;
  let endLine = defLine;

  for (let i = defLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; foundOpen = true; }
      else if (ch === '}') depth--;
    }
    if (foundOpen && depth <= 0) { endLine = i; break; }
    if (i > defLine + 500) { endLine = i; break; }
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

// ---------------------------------------------------------------------------
// Type member extraction
// ---------------------------------------------------------------------------

const CONTROL_FLOW = new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'try', 'else', 'return', 'throw', 'new', 'yield', 'await']);

function extractTypeMembers(
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

    if (depthBefore !== 1) continue;

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('[')) continue;

    // Nested type
    const nestedMatch = trimmed.match(TYPE_DEF_RE);
    if (nestedMatch) {
      const typeKind = nestedMatch[1];
      const name = nestedMatch[2];
      const kind: ASTEntityKind =
        typeKind === 'interface' ? 'InterfaceDef' :
        typeKind === 'enum' ? 'EnumDef' :
        'ClassDef';
      children.push({
        id: makeEntityId(filePath, kind, `${parentName}.${name}`),
        kind,
        name,
        scopePath: `${parentName}.${name}`,
        span: [0, 0],
        rawText: trimmed,
        signature: normalizeSignature(trimmed),
        children: [],
      });
      continue;
    }

    // Constructor: ClassName(
    const ctorMatch = trimmed.match(new RegExp(`^${MODIFIERS_RE.source}${parentName}\\s*\\(`));
    if (ctorMatch) {
      children.push({
        id: makeEntityId(filePath, 'Constructor', `${parentName}.${parentName}`),
        kind: 'Constructor',
        name: parentName,
        scopePath: `${parentName}.${parentName}`,
        span: [0, 0],
        rawText: trimmed,
        signature: normalizeSignature(trimmed),
        children: [],
      });
      continue;
    }

    // Property: type Name { get; set; } or type Name {
    const propMatch = trimmed.match(PROP_RE);
    if (propMatch) {
      const name = propMatch[1];
      if (!CONTROL_FLOW.has(name)) {
        // Check if it looks like a property (has get/set or => or the { is property accessor)
        const restOfLine = trimmed.slice(trimmed.indexOf(name) + name.length).trim();
        if (restOfLine.startsWith('{') && (
          restOfLine.includes('get') || restOfLine.includes('set') ||
          restOfLine.includes('=>') || !restOfLine.includes('(')
        )) {
          children.push({
            id: makeEntityId(filePath, 'PropertyDef', `${parentName}.${name}`),
            kind: 'PropertyDef',
            name,
            scopePath: `${parentName}.${name}`,
            span: [0, 0],
            rawText: trimmed,
            signature: normalizeSignature(trimmed),
            children: [],
          });
          continue;
        }
      }
    }

    // Method: returnType Name( or returnType Name<T>(
    const methodMatch = trimmed.match(METHOD_RE);
    if (methodMatch) {
      const name = methodMatch[1];
      if (!CONTROL_FLOW.has(name) && name !== parentName) {
        children.push({
          id: makeEntityId(filePath, 'MethodDef', `${parentName}.${name}`),
          kind: 'MethodDef',
          name,
          scopePath: `${parentName}.${name}`,
          span: [0, 0],
          rawText: trimmed,
          signature: normalizeSignature(trimmed),
          children: [],
        });
        continue;
      }
    }

    // Field: type name ; or type name =
    const fieldMatch = trimmed.match(FIELD_RE);
    if (fieldMatch) {
      const name = fieldMatch[1];
      if (!CONTROL_FLOW.has(name) && name !== 'var') {
        children.push({
          id: makeEntityId(filePath, 'PropertyDef', `${parentName}.${name}`),
          kind: 'PropertyDef',
          name,
          scopePath: `${parentName}.${name}`,
          span: [0, 0],
          rawText: trimmed,
          signature: normalizeSignature(trimmed),
          children: [],
        });
      }
    }
  }
  return children;
}

// ---------------------------------------------------------------------------
// Import extraction (using directives)
// ---------------------------------------------------------------------------

function extractImports(content: string): ImportRelation[] {
  const imports: ImportRelation[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // using Namespace;
    let match = trimmed.match(/^using\s+([A-Z][\w.]+)\s*;/);
    if (match) {
      imports.push({
        source: match[1],
        specifiers: [match[1].split('.').pop()!],
        isDefault: false,
        isNamespace: true,
        rawText: trimmed,
        span: [0, trimmed.length],
      });
      continue;
    }

    // using static Namespace.Class;
    match = trimmed.match(/^using\s+static\s+([A-Z][\w.]+)\s*;/);
    if (match) {
      imports.push({
        source: match[1],
        specifiers: [match[1].split('.').pop()!],
        isDefault: false,
        isNamespace: false,
        rawText: trimmed,
        span: [0, trimmed.length],
      });
      continue;
    }

    // using Alias = Namespace.Type;
    match = trimmed.match(/^using\s+(\w+)\s*=\s*([^;]+);/);
    if (match) {
      imports.push({
        source: match[2].trim(),
        specifiers: [match[1]],
        isDefault: true,
        isNamespace: false,
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

    // Public types are exported
    const match = trimmed.match(/^public\s+(?:(?:abstract|sealed|static|partial)\s+)*(class|interface|struct|enum|record)\s+(\w+)/);
    if (match) {
      exports.push({
        name: match[2],
        isDefault: false,
        rawText: trimmed.split('{')[0].trim(),
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
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

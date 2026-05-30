/**
 * TypeScript/JavaScript Parser Adapter
 *
 * DESIGN.md §4.2 — Structural extraction of top-level declarations
 * using regex-based parsing. This is a Tier 1 implementation that
 * extracts functions, classes, interfaces, type aliases, enums,
 * variables, imports, and exports without requiring tree-sitter.
 *
 * Tree-sitter can be swapped in later for full Tier 2 AST fidelity.
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

export const typescriptParser: ParserAdapter = {
  languages: ['typescript', 'javascript', 'tsx', 'jsx'],

  parse(content: string, filePath: string): ParseResult {
    const fileEntityId = `file:${filePath}`;
    const language = detectLanguage(filePath);

    return {
      fileEntityId,
      filePath,
      language,
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
// Language detection
// ---------------------------------------------------------------------------

function detectLanguage(filePath: string): string {
  if (filePath.endsWith('.tsx')) return 'tsx';
  if (filePath.endsWith('.jsx')) return 'jsx';
  if (filePath.endsWith('.ts')) return 'typescript';
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs'))
    return 'javascript';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Declaration extraction
// ---------------------------------------------------------------------------

/**
 * Extract top-level declarations from TypeScript/JavaScript source.
 * Uses regex patterns to identify structural boundaries.
 */
function extractDeclarations(content: string, filePath: string): ASTEntity[] {
  const declarations: ASTEntity[] = [];
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines, comments, imports, exports (handled separately)
    if (
      !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('import ') ||
      trimmed.startsWith('export default ') ||
      (trimmed.startsWith('export {') && !trimmed.includes('class') && !trimmed.includes('function'))
    ) {
      i++;
      continue;
    }

    // Strip leading export/declare/async/abstract keywords for detection
    const stripped = trimmed
      .replace(/^export\s+/, '')
      .replace(/^declare\s+/, '')
      .replace(/^abstract\s+/, '')
      .replace(/^async\s+/, '');

    const result = tryExtractDeclaration(stripped, trimmed, lines, i, filePath);
    if (result) {
      declarations.push(result.entity);
      i = result.endLine + 1;
    } else {
      i++;
    }
  }

  return declarations;
}

interface ExtractionResult {
  entity: ASTEntity;
  endLine: number;
}

function tryExtractDeclaration(
  stripped: string,
  originalLine: string,
  lines: string[],
  startLine: number,
  filePath: string,
): ExtractionResult | null {
  // Function declaration
  let match = stripped.match(/^function\s+(\w+)/);
  if (match) {
    return extractBlock(match[1], 'FunctionDef', lines, startLine, filePath);
  }

  // Class declaration
  match = stripped.match(/^class\s+(\w+)/);
  if (match) {
    return extractBlock(match[1], 'ClassDef', lines, startLine, filePath);
  }

  // Interface declaration
  match = stripped.match(/^interface\s+(\w+)/);
  if (match) {
    return extractBlock(match[1], 'InterfaceDef', lines, startLine, filePath);
  }

  // Type alias
  match = stripped.match(/^type\s+(\w+)/);
  if (match) {
    return extractTypeAlias(match[1], lines, startLine, filePath);
  }

  // Enum declaration
  match = stripped.match(/^enum\s+(\w+)/);
  if (match) {
    return extractBlock(match[1], 'EnumDef', lines, startLine, filePath);
  }

  // Variable declarations (const/let/var at top level)
  match = stripped.match(/^(?:const|let|var)\s+(\w+)/);
  if (match) {
    return extractVariable(match[1], lines, startLine, filePath);
  }

  return null;
}

/**
 * Extract a brace-delimited block (function, class, interface, enum).
 */
function extractBlock(
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
    const line = lines[i];
    for (const ch of line) {
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

    // If we haven't found an opening brace and this is a one-liner
    if (i > startLine + 50) {
      endLine = i;
      break;
    }
    endLine = i;
  }

  const rawText = lines.slice(startLine, endLine + 1).join('\n');
  const startOffset = lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);
  const endOffset = startOffset + rawText.length;

  const children = kind === 'ClassDef' || kind === 'InterfaceDef'
    ? extractClassMembers(rawText, name, filePath)
    : [];

  return {
    entity: {
      id: makeEntityId(filePath, kind, name),
      kind,
      name,
      scopePath: name,
      span: [startOffset, endOffset],
      rawText,
      signature: normalizeSignature(rawText),
      children,
    },
    endLine,
  };
}

/**
 * Extract a type alias (may span multiple lines with = ... ;).
 */
function extractTypeAlias(
  name: string,
  lines: string[],
  startLine: number,
  filePath: string,
): ExtractionResult {
  let endLine = startLine;
  let depth = 0;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '<') depth++;
      else if (ch === '}' || ch === ')' || ch === '>') depth--;
    }

    if (line.includes(';') && depth <= 0) {
      endLine = i;
      break;
    }
    endLine = i;
  }

  const rawText = lines.slice(startLine, endLine + 1).join('\n');
  const startOffset = lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);

  return {
    entity: {
      id: makeEntityId(filePath, 'TypeAlias', name),
      kind: 'TypeAlias',
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

/**
 * Extract a variable declaration.
 */
function extractVariable(
  name: string,
  lines: string[],
  startLine: number,
  filePath: string,
): ExtractionResult {
  let endLine = startLine;
  let depth = 0;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') depth--;
    }

    if (depth <= 0 && (line.includes(';') || (i > startLine && lines[i + 1]?.trim().match(/^(?:export|const|let|var|function|class|interface|type|enum|import)\s/)))) {
      endLine = i;
      break;
    }
    endLine = i;
  }

  const rawText = lines.slice(startLine, endLine + 1).join('\n');
  const startOffset = lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);

  return {
    entity: {
      id: makeEntityId(filePath, 'VariableDecl', name),
      kind: 'VariableDecl',
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

/**
 * Extract class/interface members as child entities.
 */
function extractClassMembers(
  classText: string,
  className: string,
  filePath: string,
): ASTEntity[] {
  const children: ASTEntity[] = [];
  const lines = classText.split('\n');

  // Skip the class opening line
  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;

    // Method
    const methodMatch = line.match(
      /^(?:(?:public|private|protected|static|async|abstract|readonly)\s+)*(\w+)\s*\(/,
    );
    if (methodMatch && methodMatch[1] !== 'if' && methodMatch[1] !== 'for' && methodMatch[1] !== 'while') {
      const methodName = methodMatch[1];
      const kind: ASTEntityKind = methodName === 'constructor' ? 'Constructor' : 'MethodDef';
      children.push({
        id: makeEntityId(filePath, kind, `${className}.${methodName}`),
        kind,
        name: methodName,
        scopePath: `${className}.${methodName}`,
        span: [0, 0], // Simplified for Tier 1
        rawText: line,
        signature: normalizeSignature(line),
        children: [],
      });
      continue;
    }

    // Property
    const propMatch = line.match(
      /^(?:(?:public|private|protected|static|readonly)\s+)*(\w+)\s*[?:]/, 
    );
    if (propMatch) {
      const propName = propMatch[1];
      children.push({
        id: makeEntityId(filePath, 'PropertyDef', `${className}.${propName}`),
        kind: 'PropertyDef',
        name: propName,
        scopePath: `${className}.${propName}`,
        span: [0, 0],
        rawText: line,
        signature: normalizeSignature(line),
        children: [],
      });
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('import ')) continue;

    // Collect multi-line imports
    let full = line;
    while (!full.includes(';') && !full.match(/from\s+['"]/) && i + 1 < lines.length) {
      i++;
      full += ' ' + lines[i].trim();
    }
    if (!full.includes(';') && i + 1 < lines.length) {
      i++;
      full += ' ' + lines[i].trim();
    }

    const rel = parseImport(full);
    if (rel) imports.push(rel);
  }

  return imports;
}

function parseImport(text: string): ImportRelation | null {
  // import { a, b } from 'module'
  const namedMatch = text.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
  if (namedMatch) {
    const specifiers = namedMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    return {
      source: namedMatch[2],
      specifiers,
      isDefault: false,
      isNamespace: false,
      rawText: text,
      span: [0, text.length],
    };
  }

  // import Default from 'module'
  const defaultMatch = text.match(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
  if (defaultMatch) {
    return {
      source: defaultMatch[2],
      specifiers: [defaultMatch[1]],
      isDefault: true,
      isNamespace: false,
      rawText: text,
      span: [0, text.length],
    };
  }

  // import * as Name from 'module'
  const nsMatch = text.match(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
  if (nsMatch) {
    return {
      source: nsMatch[2],
      specifiers: [nsMatch[1]],
      isDefault: false,
      isNamespace: true,
      rawText: text,
      span: [0, text.length],
    };
  }

  // import 'module' (side-effect only)
  const sideEffectMatch = text.match(/import\s+['"]([^'"]+)['"]/);
  if (sideEffectMatch) {
    return {
      source: sideEffectMatch[1],
      specifiers: [],
      isDefault: false,
      isNamespace: false,
      rawText: text,
      span: [0, text.length],
    };
  }

  // import type { ... } from 'module'
  const typeMatch = text.match(/import\s+type\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
  if (typeMatch) {
    const specifiers = typeMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    return {
      source: typeMatch[2],
      specifiers,
      isDefault: false,
      isNamespace: false,
      rawText: text,
      span: [0, text.length],
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

function extractExports(content: string): ExportRelation[] {
  const exports: ExportRelation[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // export default ...
    if (trimmed.startsWith('export default ')) {
      const nameMatch = trimmed.match(/export default (?:class|function)?\s*(\w+)?/);
      exports.push({
        name: nameMatch?.[1] ?? 'default',
        isDefault: true,
        rawText: trimmed,
        span: [0, trimmed.length],
      });
      continue;
    }

    // export { ... } from '...' or export { ... }
    const reExportMatch = trimmed.match(/export\s+\{([^}]+)\}(?:\s+from\s+['"]([^'"]+)['"])?/);
    if (reExportMatch && !trimmed.match(/export\s+(?:function|class|interface|type|enum|const|let|var)/)) {
      const names = reExportMatch[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean);
      for (const name of names) {
        exports.push({
          name,
          isDefault: false,
          source: reExportMatch[2],
          rawText: trimmed,
          span: [0, trimmed.length],
        });
      }
      continue;
    }

    // export * from '...'
    const starMatch = trimmed.match(/export\s+\*\s+from\s+['"]([^'"]+)['"]/);
    if (starMatch) {
      exports.push({
        name: '*',
        isDefault: false,
        source: starMatch[1],
        rawText: trimmed,
        span: [0, trimmed.length],
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

  // Diff declarations
  const oldDecls = new Map(oldResult.declarations.map((d) => [d.id, d]));
  const newDecls = new Map(newResult.declarations.map((d) => [d.id, d]));

  // Also index by name for rename detection
  const oldByName = new Map(oldResult.declarations.map((d) => [d.name, d]));
  const newByName = new Map(newResult.declarations.map((d) => [d.name, d]));

  // Detect additions
  for (const [id, entity] of newDecls) {
    if (!oldDecls.has(id)) {
      // Check if this is a rename (same signature, different name)
      const oldEntity = findRenamedEntity(entity, oldResult.declarations, newDecls);
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

  // Detect removals
  for (const [id, entity] of oldDecls) {
    if (!newDecls.has(id)) {
      // Skip if this was a rename (already handled above)
      const wasRenamed = findRenamedEntity(entity, newResult.declarations, oldDecls);
      if (!wasRenamed) {
        patches.push({ kind: 'symbolRemove', entityId: id, entityName: entity.name });
      }
    }
  }

  // Detect modifications
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

  // Diff imports
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
    } else if (JSON.stringify(oldImp.specifiers.sort()) !== JSON.stringify(imp.specifiers.sort())) {
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

  // Diff exports
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

/**
 * Find a possible renamed entity: same kind and similar signature, different name.
 */
function findRenamedEntity(
  entity: ASTEntity,
  candidates: ASTEntity[],
  existingIds: Map<string, ASTEntity>,
): ASTEntity | null {
  for (const candidate of candidates) {
    if (candidate.kind !== entity.kind) continue;
    if (candidate.name === entity.name) continue;
    if (existingIds.has(candidate.id)) continue; // Still exists — not a rename

    // Check signature similarity (replace name occurrences)
    const normalizedOld = candidate.signature.replace(new RegExp(candidate.name, 'g'), '___');
    const normalizedNew = entity.signature.replace(new RegExp(entity.name, 'g'), '___');
    if (normalizedOld === normalizedNew) {
      return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntityId(filePath: string, kind: string, name: string): string {
  return `${kind}:${filePath}:${name}`;
}

/**
 * Normalize a code snippet to a structural signature:
 * strip comments, collapse whitespace, remove trailing semicolons.
 */
function normalizeSignature(text: string): string {
  return text
    .replace(/\/\/[^\n]*/g, '')          // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')    // block comments
    .replace(/\s+/g, ' ')               // collapse whitespace
    .replace(/;\s*$/, '')                // trailing semicolons
    .trim();
}

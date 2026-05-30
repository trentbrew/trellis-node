/**
 * Python Parser Adapter
 *
 * Tier 1 regex-based parser for Python source files.
 * Extracts classes, functions, decorators, async functions,
 * type hints, imports, and module-level variables.
 *
 * @see TRL-5
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

export const pythonParser: ParserAdapter = {
  languages: ['python'],

  parse(content: string, filePath: string): ParseResult {
    const fileEntityId = `file:${filePath}`;

    return {
      fileEntityId,
      filePath,
      language: 'python',
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

/**
 * Extract top-level declarations from Python source.
 * Handles: class, def, async def, and module-level assignments.
 * Respects indentation to determine block boundaries.
 */
function extractDeclarations(content: string, filePath: string): ASTEntity[] {
  const declarations: ASTEntity[] = [];
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines, comments, string literals used as docstrings
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('"""') ||
      trimmed.startsWith("'''")
    ) {
      i++;
      continue;
    }

    // Only consider top-level (zero indentation)
    if ((line.length > 0 && line[0] === ' ') || line[0] === '\t') {
      i++;
      continue;
    }

    // Collect decorators
    const decorators: string[] = [];
    const decoratorStart = i;
    while (i < lines.length && lines[i].trim().startsWith('@')) {
      decorators.push(lines[i].trim());
      i++;
    }

    if (i >= lines.length) break;
    const declLine = lines[i].trim();

    // Class definition
    let match = declLine.match(/^class\s+(\w+)/);
    if (match) {
      const result = extractIndentedBlock(
        match[1],
        'ClassDef',
        lines,
        decorators.length > 0 ? decoratorStart : i,
        i,
        filePath,
        decorators,
      );
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Async function
    match = declLine.match(/^async\s+def\s+(\w+)/);
    if (match) {
      const result = extractIndentedBlock(
        match[1],
        'FunctionDef',
        lines,
        decorators.length > 0 ? decoratorStart : i,
        i,
        filePath,
        decorators,
      );
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Function definition
    match = declLine.match(/^def\s+(\w+)/);
    if (match) {
      const result = extractIndentedBlock(
        match[1],
        'FunctionDef',
        lines,
        decorators.length > 0 ? decoratorStart : i,
        i,
        filePath,
        decorators,
      );
      declarations.push(result.entity);
      i = result.endLine + 1;
      continue;
    }

    // Module-level variable assignment (e.g. `MY_VAR = ...` or `MY_VAR: int = ...`)
    match = declLine.match(/^([A-Za-z_]\w*)\s*(?::\s*\w[^=]*)?\s*=/);
    if (
      match &&
      match[1] !== '__all__' &&
      !declLine.startsWith('import ') &&
      !declLine.startsWith('from ')
    ) {
      const result = extractAssignment(match[1], lines, i, filePath);
      if (decorators.length === 0) {
        declarations.push(result.entity);
      }
      i = result.endLine + 1;
      continue;
    }

    // If we collected decorators but no matching def/class, skip
    if (decorators.length > 0) {
      i++;
      continue;
    }

    i++;
  }

  return declarations;
}

// ---------------------------------------------------------------------------
// Block extraction (indentation-based)
// ---------------------------------------------------------------------------

interface ExtractionResult {
  entity: ASTEntity;
  endLine: number;
}

/**
 * Extract a Python indentation-delimited block (class or function).
 */
function extractIndentedBlock(
  name: string,
  kind: ASTEntityKind,
  lines: string[],
  startLine: number,
  defLine: number,
  filePath: string,
  decorators: string[],
): ExtractionResult {
  // Find the colon at end of def/class line (may span multiple lines for long signatures)
  let headerEnd = defLine;
  while (headerEnd < lines.length && !lines[headerEnd].includes(':')) {
    headerEnd++;
  }

  // Determine body indentation from the first non-empty line after header
  let bodyIndent = -1;
  let endLine = headerEnd;

  for (let i = headerEnd + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comment-only lines
    if (!trimmed || trimmed.startsWith('#')) {
      endLine = i;
      continue;
    }

    const indent = line.length - line.trimStart().length;

    if (bodyIndent < 0) {
      // First non-empty line in body sets the expected indent
      bodyIndent = indent;
      endLine = i;
      continue;
    }

    if (indent >= bodyIndent) {
      endLine = i;
    } else {
      // Dedented — block is over
      break;
    }
  }

  // Trim trailing empty lines from the block
  while (endLine > headerEnd && lines[endLine].trim() === '') {
    endLine--;
  }

  const rawText = lines.slice(startLine, endLine + 1).join('\n');
  const startOffset =
    lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);

  const children =
    kind === 'ClassDef'
      ? extractClassMembers(
          lines,
          headerEnd,
          endLine,
          bodyIndent,
          name,
          filePath,
        )
      : [];

  return {
    entity: {
      id: makeEntityId(filePath, kind, name),
      kind,
      name,
      scopePath: name,
      span: [startOffset, startOffset + rawText.length],
      rawText,
      signature: normalizeSignature(rawText),
      children,
    },
    endLine,
  };
}

/**
 * Extract a module-level variable assignment (may span multiple lines).
 */
function extractAssignment(
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
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
    }

    endLine = i;

    // Assignment ends when depth returns to 0 and we're past the first line,
    // or the next line is a new top-level statement
    if (depth <= 0 && i > startLine) break;
    if (depth <= 0 && i === startLine) {
      // Check if next line is indented (continuation) or a new statement
      if (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (!next.trim() || (!next.startsWith(' ') && !next.startsWith('\t'))) {
          break;
        }
      } else {
        break;
      }
    }
  }

  const rawText = lines.slice(startLine, endLine + 1).join('\n');
  const startOffset =
    lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);

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

// ---------------------------------------------------------------------------
// Class member extraction
// ---------------------------------------------------------------------------

function extractClassMembers(
  lines: string[],
  headerEnd: number,
  blockEnd: number,
  bodyIndent: number,
  className: string,
  filePath: string,
): ASTEntity[] {
  const children: ASTEntity[] = [];
  if (bodyIndent < 0) return children;

  for (let i = headerEnd + 1; i <= blockEnd; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('"""') ||
      trimmed.startsWith("'''")
    )
      continue;

    const indent = line.length - line.trimStart().length;
    if (indent !== bodyIndent) continue;

    // Skip decorators (they precede a method)
    if (trimmed.startsWith('@')) continue;

    // Method (def / async def)
    let match = trimmed.match(/^(?:async\s+)?def\s+(\w+)/);
    if (match) {
      const methodName = match[1];
      const kind: ASTEntityKind =
        methodName === '__init__' ? 'Constructor' : 'MethodDef';
      children.push({
        id: makeEntityId(filePath, kind, `${className}.${methodName}`),
        kind,
        name: methodName,
        scopePath: `${className}.${methodName}`,
        span: [0, 0],
        rawText: trimmed,
        signature: normalizeSignature(trimmed),
        children: [],
      });
      continue;
    }

    // Class-level variable / property (e.g. `name: str = "default"`)
    match = trimmed.match(/^(\w+)\s*(?::\s*\S[^=]*)?\s*=/);
    if (match) {
      children.push({
        id: makeEntityId(filePath, 'PropertyDef', `${className}.${match[1]}`),
        kind: 'PropertyDef',
        name: match[1],
        scopePath: `${className}.${match[1]}`,
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
// Import extraction
// ---------------------------------------------------------------------------

function extractImports(content: string): ImportRelation[] {
  const imports: ImportRelation[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // from module import ...
    let match = trimmed.match(/^from\s+([\w.]+)\s+import\s+(.+)/);
    if (match) {
      let specText = match[2];

      // Handle multi-line imports: from mod import (a, b, ...)
      if (specText.includes('(') && !specText.includes(')')) {
        while (i + 1 < lines.length && !specText.includes(')')) {
          i++;
          specText += ' ' + lines[i].trim();
        }
      }

      // Strip parens and trailing comments
      specText = specText.replace(/[()]/g, '').replace(/#.*$/, '');
      const specifiers = specText
        .split(',')
        .map(
          (s) =>
            s
              .trim()
              .split(/\s+as\s+/)
              .pop()!,
        )
        .filter(Boolean);

      const isWildcard = specifiers.includes('*');

      imports.push({
        source: match[1],
        specifiers: isWildcard ? ['*'] : specifiers,
        isDefault: false,
        isNamespace: isWildcard,
        rawText: trimmed,
        span: [0, trimmed.length],
      });
      continue;
    }

    // import module [as alias]
    match = trimmed.match(/^import\s+([\w.,\s]+)/);
    if (match) {
      const modules = match[1].split(',').map((m) => m.trim());
      for (const mod of modules) {
        const parts = mod.split(/\s+as\s+/);
        const source = parts[0].trim();
        const alias = parts.length > 1 ? parts[1].trim() : source;
        imports.push({
          source,
          specifiers: [alias],
          isDefault: true,
          isNamespace: false,
          rawText: trimmed,
          span: [0, trimmed.length],
        });
      }
    }
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

/**
 * Python uses __all__ to declare public API. We also treat
 * top-level public names (not starting with _) as exports.
 */
function extractExports(content: string): ExportRelation[] {
  const exports: ExportRelation[] = [];

  // Look for __all__ = [...]
  const allMatch = content.match(/__all__\s*=\s*\[([^\]]*)\]/s);
  if (allMatch) {
    const names = allMatch[1]
      .replace(/['"]/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const name of names) {
      exports.push({
        name,
        isDefault: false,
        rawText: `__all__: ${name}`,
        span: [0, 0],
      });
    }
  }

  return exports;
}

// ---------------------------------------------------------------------------
// Semantic diff (reuses generic algorithm from ts-parser pattern)
// ---------------------------------------------------------------------------

function computeSemanticDiff(
  oldResult: ParseResult,
  newResult: ParseResult,
): SemanticPatch[] {
  const patches: SemanticPatch[] = [];
  const fileId = newResult.fileEntityId;

  const oldDecls = new Map(oldResult.declarations.map((d) => [d.id, d]));
  const newDecls = new Map(newResult.declarations.map((d) => [d.id, d]));

  // Detect additions (+ rename detection)
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

  // Detect removals
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
    if (normalizedOld === normalizedNew) {
      return candidate;
    }
  }
  return null;
}

function makeEntityId(filePath: string, kind: string, name: string): string {
  return `${kind}:${filePath}:${name}`;
}

function normalizeSignature(text: string): string {
  return text
    .replace(/#[^\n]*/g, '') // line comments
    .replace(/"""[\s\S]*?"""/g, '') // docstrings (triple double)
    .replace(/'''[\s\S]*?'''/g, '') // docstrings (triple single)
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

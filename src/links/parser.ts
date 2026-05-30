/**
 * Wiki-Link Parser
 *
 * Parses [[...]] references from markdown files and doc-comments
 * in source code. Supports namespaced and bare syntax with smart
 * namespace inference.
 *
 * @see TRL-11
 */

import type { EntityRef, RefContext, RefNamespace, RefSource } from './types.js';

// ---------------------------------------------------------------------------
// Main regex for [[...]] wiki-links
// ---------------------------------------------------------------------------

/**
 * Matches [[target]] or [[target|alias]] where target may include
 * namespace prefix, file paths, and #anchors.
 *
 * Captures:
 *   [1] = inner content (everything between [[ and ]])
 */
const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

// ---------------------------------------------------------------------------
// Known file extensions for bare ref inference
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'pyi',
  'go',
  'rs',
  'rb',
  'java',
  'cs',
  'md',
  'json', 'yaml', 'yml', 'toml',
  'css', 'scss', 'less',
  'html', 'vue', 'svelte',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse all [[...]] references from a file's content.
 * Detects context (markdown vs doc-comment) based on file extension.
 */
export function parseFileRefs(content: string, filePath: string): EntityRef[] {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'md') {
    return parseMarkdownRefs(content, filePath);
  }

  // Source code: extract refs from doc-comments only
  return parseDocCommentRefs(content, filePath, ext);
}

/**
 * Parse all [[...]] references from markdown content.
 */
export function parseMarkdownRefs(content: string, filePath: string): EntityRef[] {
  return extractRefs(content, filePath, 'markdown');
}

/**
 * Parse [[...]] references from doc-comments in source code.
 * Extracts comment blocks first, then scans them for wiki-links.
 */
export function parseDocCommentRefs(
  content: string,
  filePath: string,
  ext?: string,
): EntityRef[] {
  const fileExt = ext ?? (filePath.split('.').pop()?.toLowerCase() ?? '');
  const commentBlocks = extractDocComments(content, fileExt);
  const refs: EntityRef[] = [];

  for (const block of commentBlocks) {
    const blockRefs = extractRefs(block.text, filePath, block.context, block.startLine);
    refs.push(...blockRefs);
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Core extraction
// ---------------------------------------------------------------------------

interface CommentBlock {
  text: string;
  startLine: number;
  context: RefContext;
}

/**
 * Extract all [[...]] wiki-links from a text block.
 */
function extractRefs(
  text: string,
  filePath: string,
  context: RefContext,
  lineOffset: number = 0,
): EntityRef[] {
  const refs: EntityRef[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;

    // Reset regex state for each line
    const re = new RegExp(WIKI_LINK_RE.source, WIKI_LINK_RE.flags);

    while ((match = re.exec(line)) !== null) {
      const raw = match[1];
      const col = match.index;
      const lineNum = i + 1 + lineOffset;

      const parsed = parseRefContent(raw);
      if (!parsed) continue;

      refs.push({
        ...parsed,
        raw,
        source: {
          filePath,
          line: lineNum,
          col,
          context,
        },
      });
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Ref content parsing and namespace inference
// ---------------------------------------------------------------------------

interface ParsedRef {
  namespace: RefNamespace;
  target: string;
  anchor?: string;
  alias?: string;
}

/**
 * Parse the inner content of a [[...]] wiki-link.
 *
 * Supported forms:
 *   - "namespace:target"           → explicit namespace
 *   - "namespace:target|alias"     → explicit namespace + alias
 *   - "namespace:target#anchor"    → explicit namespace + anchor
 *   - "target"                     → infer namespace
 *   - "target|alias"               → infer namespace + alias
 *   - "path#anchor"                → symbol ref
 *   - "path#anchor|alias"          → symbol ref + alias
 */
export function parseRefContent(raw: string): ParsedRef | null {
  if (!raw || !raw.trim()) return null;

  // Split alias first: "content|alias"
  let content: string;
  let alias: string | undefined;

  const pipeIdx = raw.indexOf('|');
  if (pipeIdx !== -1) {
    content = raw.substring(0, pipeIdx).trim();
    alias = raw.substring(pipeIdx + 1).trim();
    if (!alias) alias = undefined;
  } else {
    content = raw.trim();
  }

  if (!content) return null;

  // Check for explicit namespace: "namespace:rest"
  const colonIdx = content.indexOf(':');
  if (colonIdx !== -1) {
    const possibleNs = content.substring(0, colonIdx);
    if (isValidNamespace(possibleNs)) {
      const rest = content.substring(colonIdx + 1);
      const { target, anchor } = splitAnchor(rest);
      const ns = possibleNs as RefNamespace;
      return { namespace: ns, target, anchor, alias };
    }
  }

  // No explicit namespace — infer from content
  const { target, anchor } = splitAnchor(content);

  const inferred = inferNamespace(target, anchor);
  if (!inferred) return null;

  return { namespace: inferred, target, anchor, alias };
}

/**
 * Split "path#anchor" into { target, anchor }.
 */
function splitAnchor(content: string): { target: string; anchor?: string } {
  const hashIdx = content.indexOf('#');
  if (hashIdx === -1) return { target: content };
  return {
    target: content.substring(0, hashIdx),
    anchor: content.substring(hashIdx + 1) || undefined,
  };
}

const VALID_NAMESPACES = new Set<string>([
  'issue', 'file', 'symbol', 'identity', 'milestone', 'decision',
]);

function isValidNamespace(s: string): boolean {
  return VALID_NAMESPACES.has(s);
}

/**
 * Infer the namespace from bare ref content.
 *
 * Rules (in order):
 *   1. TRL-\d+ pattern → issue
 *   2. DEC-\d+ pattern → decision
 *   3. Has anchor (#) → symbol
 *   4. Contains '/' or has known file extension → file
 *   5. Otherwise → null (namespace required)
 */
export function inferNamespace(target: string, anchor?: string): RefNamespace | null {
  // Issue pattern: TRL-1, TRL-42, etc.
  if (/^TRL-\d+$/i.test(target)) return 'issue';

  // Decision pattern: DEC-1, DEC-42, etc.
  if (/^DEC-\d+$/i.test(target)) return 'decision';

  // Symbol: has anchor
  if (anchor) return 'symbol';

  // File path: contains slash or has known extension
  if (target.includes('/')) return 'file';
  const ext = target.split('.').pop()?.toLowerCase();
  if (ext && CODE_EXTENSIONS.has(ext)) return 'file';

  // Cannot infer — namespace required
  return null;
}

// ---------------------------------------------------------------------------
// Doc-comment extraction
// ---------------------------------------------------------------------------

/**
 * Extract doc-comment blocks from source code based on language.
 */
function extractDocComments(content: string, ext: string): CommentBlock[] {
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
    case 'java':
    case 'cs':
      return extractJSDocComments(content);
    case 'py':
    case 'pyi':
      return extractPythonDocstrings(content);
    case 'rs':
      return extractRustDocComments(content);
    case 'go':
      return extractGoDocComments(content);
    case 'rb':
      return extractRubyDocComments(content);
    default:
      return [];
  }
}

/**
 * Extract JSDoc-style comments: /** ... * / and // comments
 */
function extractJSDocComments(content: string): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  const lines = content.split('\n');

  let inBlock = false;
  let blockLines: string[] = [];
  let blockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Block comment start: /** or /*
    if (!inBlock && (trimmed.startsWith('/**') || trimmed.startsWith('/*'))) {
      inBlock = true;
      blockStart = i;
      blockLines = [trimmed];

      // Single-line block comment: /** ... */
      if (trimmed.endsWith('*/') && trimmed.length > 4) {
        blocks.push({
          text: stripBlockCommentMarkers(blockLines.join('\n')),
          startLine: blockStart,
          context: 'jsdoc',
        });
        inBlock = false;
        blockLines = [];
      }
      continue;
    }

    if (inBlock) {
      blockLines.push(trimmed);
      if (trimmed.includes('*/')) {
        blocks.push({
          text: stripBlockCommentMarkers(blockLines.join('\n')),
          startLine: blockStart,
          context: 'jsdoc',
        });
        inBlock = false;
        blockLines = [];
      }
      continue;
    }

    // Single-line // comments
    if (trimmed.startsWith('//')) {
      blocks.push({
        text: trimmed.replace(/^\/\/\s?/, ''),
        startLine: i,
        context: 'comment',
      });
    }
  }

  return blocks;
}

/**
 * Strip block comment markers (/** * * /) from text.
 */
function stripBlockCommentMarkers(text: string): string {
  return text
    .replace(/^\/\*\*?\s?/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .trim();
}

/**
 * Extract Python docstrings (triple-quoted strings).
 */
function extractPythonDocstrings(content: string): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  const lines = content.split('\n');

  let inDocstring = false;
  let delimiter = '';
  let blockLines: string[] = [];
  let blockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!inDocstring) {
      // Check for docstring start
      for (const delim of ['"""', "'''"]) {
        if (trimmed.startsWith(delim)) {
          // Single-line docstring
          if (trimmed.endsWith(delim) && trimmed.length > delim.length * 2) {
            blocks.push({
              text: trimmed.slice(delim.length, -delim.length).trim(),
              startLine: i,
              context: 'pydoc',
            });
            break;
          }
          // Multi-line docstring start
          inDocstring = true;
          delimiter = delim;
          blockStart = i;
          blockLines = [trimmed.slice(delim.length)];
          break;
        }
      }
      // Also capture # comments
      if (!inDocstring && trimmed.startsWith('#')) {
        blocks.push({
          text: trimmed.replace(/^#\s?/, ''),
          startLine: i,
          context: 'comment',
        });
      }
    } else {
      if (trimmed.endsWith(delimiter)) {
        blockLines.push(trimmed.slice(0, -delimiter.length));
        blocks.push({
          text: blockLines.join('\n').trim(),
          startLine: blockStart,
          context: 'pydoc',
        });
        inDocstring = false;
        blockLines = [];
      } else {
        blockLines.push(trimmed);
      }
    }
  }

  return blocks;
}

/**
 * Extract Rust doc-comments (/// and //!).
 */
function extractRustDocComments(content: string): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('///') || trimmed.startsWith('//!')) {
      blocks.push({
        text: trimmed.replace(/^\/\/[\/!]\s?/, ''),
        startLine: i,
        context: 'rustdoc',
      });
    }
  }

  return blocks;
}

/**
 * Extract Go doc-comments (// comments preceding declarations).
 */
function extractGoDocComments(content: string): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//')) {
      blocks.push({
        text: trimmed.replace(/^\/\/\s?/, ''),
        startLine: i,
        context: 'godoc',
      });
    }
  }

  return blocks;
}

/**
 * Extract Ruby doc-comments (# comments).
 */
function extractRubyDocComments(content: string): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#')) {
      blocks.push({
        text: trimmed.replace(/^#\s?/, ''),
        startLine: i,
        context: 'comment',
      });
    }
  }

  return blocks;
}

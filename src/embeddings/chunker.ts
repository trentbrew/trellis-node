/**
 * Text Chunker
 *
 * Strategies for splitting different content types into embeddable chunks.
 * Short text is embedded as-is; markdown is split by headings; code entities
 * are chunked by declaration; large text uses sliding window.
 *
 * @see TRL-19
 */

import type { ChunkMeta, ChunkType } from './types.js';

// ---------------------------------------------------------------------------
// Chunk configuration
// ---------------------------------------------------------------------------

/** Max characters per chunk before splitting (roughly ~128 tokens) */
const MAX_CHUNK_CHARS = 512;
/** Overlap characters for sliding window */
const OVERLAP_CHARS = 64;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Chunk an issue into embeddable pieces.
 */
export function chunkIssue(issue: {
  id: string;
  title?: string;
  description?: string;
}): ChunkMeta[] {
  const now = new Date().toISOString();
  const chunks: ChunkMeta[] = [];

  if (issue.title) {
    chunks.push({
      id: `issue:${issue.id}:title`,
      entityId: `issue:${issue.id}`,
      content: issue.title,
      chunkType: 'issue_title',
      updatedAt: now,
    });
  }

  if (issue.description) {
    chunks.push({
      id: `issue:${issue.id}:desc`,
      entityId: `issue:${issue.id}`,
      content: issue.description,
      chunkType: 'issue_desc',
      updatedAt: now,
    });
  }

  return chunks;
}

/**
 * Chunk a decision trace into embeddable pieces.
 * Combines tool name, rationale, context, and output summary.
 */
export function chunkDecision(decision: {
  id: string;
  toolName: string;
  rationale?: string;
  context?: string;
  outputSummary?: string;
}): ChunkMeta[] {
  const parts: string[] = [];
  parts.push(`Decision ${decision.id}: ${decision.toolName}`);
  if (decision.rationale) parts.push(`Rationale: ${decision.rationale}`);
  if (decision.context) parts.push(`Context: ${decision.context}`);
  if (decision.outputSummary) parts.push(`Output: ${decision.outputSummary}`);

  const content = parts.join('\n');
  if (!content.trim()) return [];

  return [
    {
      id: `decision:${decision.id}:rationale`,
      entityId: `decision:${decision.id}`,
      content,
      chunkType: 'decision_rationale',
      updatedAt: new Date().toISOString(),
    },
  ];
}

/**
 * Chunk a milestone message.
 */
export function chunkMilestone(milestone: {
  id: string;
  message?: string;
}): ChunkMeta[] {
  if (!milestone.message) return [];

  return [
    {
      id: `milestone:${milestone.id}:msg`,
      entityId: `milestone:${milestone.id}`,
      content: milestone.message,
      chunkType: 'milestone_msg',
      updatedAt: new Date().toISOString(),
    },
  ];
}

/**
 * Chunk a markdown file by heading sections.
 * Each H1/H2/H3 section becomes a separate chunk.
 * Sections that exceed MAX_CHUNK_CHARS get sliding-window split.
 */
export function chunkMarkdown(filePath: string, content: string): ChunkMeta[] {
  if (!content.trim()) return [];

  const entityId = `file:${filePath}`;
  const now = new Date().toISOString();
  const sections = splitByHeadings(content);
  const chunks: ChunkMeta[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section.text.trim()) continue;

    if (section.text.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        id: `${entityId}:section:${i}`,
        entityId,
        content: section.text,
        chunkType: 'markdown',
        filePath,
        updatedAt: now,
      });
    } else {
      // Split long sections with sliding window
      const windows = slidingWindow(section.text);
      for (let w = 0; w < windows.length; w++) {
        chunks.push({
          id: `${entityId}:section:${i}:w${w}`,
          entityId,
          content: windows[w],
          chunkType: 'markdown',
          filePath,
          updatedAt: now,
        });
      }
    }
  }

  return chunks;
}

/**
 * Chunk code entities (functions, classes, interfaces) from a parsed file.
 * Each declaration's signature + doc-comment becomes a chunk.
 */
export function chunkCodeEntities(
  filePath: string,
  declarations: Array<{
    id: string;
    name: string;
    kind: string;
    signature: string;
    docComment?: string;
  }>,
): ChunkMeta[] {
  const now = new Date().toISOString();
  const chunks: ChunkMeta[] = [];

  for (const decl of declarations) {
    const parts: string[] = [];
    if (decl.docComment) parts.push(decl.docComment);
    parts.push(`${decl.kind} ${decl.name}`);
    parts.push(decl.signature);

    const content = parts.join('\n').slice(0, MAX_CHUNK_CHARS);

    chunks.push({
      id: `symbol:${filePath}#${decl.name}`,
      entityId: `symbol:${filePath}#${decl.name}`,
      content,
      chunkType: 'code_entity',
      filePath,
      updatedAt: now,
    });
  }

  return chunks;
}

/**
 * Chunk doc-comments extracted from source files.
 */
export function chunkDocComments(
  filePath: string,
  comments: Array<{ line: number; text: string }>,
): ChunkMeta[] {
  if (comments.length === 0) return [];

  const entityId = `file:${filePath}`;
  const now = new Date().toISOString();
  const chunks: ChunkMeta[] = [];

  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i];
    if (!comment.text.trim()) continue;

    chunks.push({
      id: `${entityId}:doc:${i}`,
      entityId,
      content: comment.text.slice(0, MAX_CHUNK_CHARS),
      chunkType: 'doc_comment',
      filePath,
      updatedAt: now,
    });
  }

  return chunks;
}

/**
 * Chunk a summary.md or similar short-to-medium text file.
 */
export function chunkSummary(filePath: string, content: string): ChunkMeta[] {
  if (!content.trim()) return [];

  const entityId = `file:${filePath}`;
  const now = new Date().toISOString();

  if (content.length <= MAX_CHUNK_CHARS) {
    return [
      {
        id: `${entityId}:summary`,
        entityId,
        content,
        chunkType: 'summary_md',
        filePath,
        updatedAt: now,
      },
    ];
  }

  // Split by headings for longer summaries
  return chunkMarkdown(filePath, content).map((c) => ({
    ...c,
    chunkType: 'summary_md' as ChunkType,
  }));
}

/**
 * Auto-detect file type and chunk accordingly.
 */
export function chunkFile(filePath: string, content: string): ChunkMeta[] {
  if (!content.trim()) return [];

  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

  // summary.md files
  if (filePath.endsWith('summary.md')) {
    return chunkSummary(filePath, content);
  }

  // Markdown files
  if (ext === 'md') {
    return chunkMarkdown(filePath, content);
  }

  // Source files — we only chunk doc-comments (code entities are handled separately)
  // Return empty — code entities are handled via chunkCodeEntities from parsed AST
  return [];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface Section {
  heading?: string;
  text: string;
}

/**
 * Split markdown content by heading boundaries (# H1, ## H2, ### H3).
 */
function splitByHeadings(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  let currentSection: Section = { text: '' };

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      // New heading — start a new section
      if (currentSection.text.trim()) {
        sections.push(currentSection);
      }
      currentSection = { heading: line, text: line + '\n' };
    } else {
      currentSection.text += line + '\n';
    }
  }

  if (currentSection.text.trim()) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Split long text into overlapping windows.
 */
export function slidingWindow(text: string): string[] {
  const windows: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + MAX_CHUNK_CHARS, text.length);
    windows.push(text.slice(start, end));
    if (end >= text.length) break;
    start += MAX_CHUNK_CHARS - OVERLAP_CHARS;
  }

  return windows;
}

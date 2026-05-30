/**
 * Chunker Tests
 *
 * Tests text chunking strategies for different content types.
 *
 * @see TRL-19
 */

import { describe, it, expect } from 'vitest';
import {
  chunkIssue,
  chunkMilestone,
  chunkMarkdown,
  chunkCodeEntities,
  chunkDocComments,
  chunkSummary,
  chunkFile,
  slidingWindow,
} from '../../src/embeddings/chunker.js';

// ---------------------------------------------------------------------------
// chunkIssue
// ---------------------------------------------------------------------------

describe('chunkIssue', () => {
  it('creates title and description chunks', () => {
    const chunks = chunkIssue({
      id: 'TRL-5',
      title: 'Add Python parser',
      description: 'Implement a Python AST parser for semantic analysis',
    });
    expect(chunks.length).toBe(2);
    expect(chunks[0].chunkType).toBe('issue_title');
    expect(chunks[0].content).toBe('Add Python parser');
    expect(chunks[0].entityId).toBe('issue:TRL-5');
    expect(chunks[1].chunkType).toBe('issue_desc');
  });

  it('skips missing fields', () => {
    const chunks = chunkIssue({ id: 'TRL-1' });
    expect(chunks.length).toBe(0);
  });

  it('creates only title chunk when no description', () => {
    const chunks = chunkIssue({ id: 'TRL-2', title: 'Fix bug' });
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkType).toBe('issue_title');
  });
});

// ---------------------------------------------------------------------------
// chunkMilestone
// ---------------------------------------------------------------------------

describe('chunkMilestone', () => {
  it('creates a milestone message chunk', () => {
    const chunks = chunkMilestone({
      id: 'abc123',
      message: 'Implement authentication system',
    });
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkType).toBe('milestone_msg');
    expect(chunks[0].entityId).toBe('milestone:abc123');
  });

  it('returns empty for missing message', () => {
    const chunks = chunkMilestone({ id: 'abc123' });
    expect(chunks.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// chunkMarkdown
// ---------------------------------------------------------------------------

describe('chunkMarkdown', () => {
  it('splits markdown by headings', () => {
    const content = `# Introduction
Some intro text.

## Design
Design details here.

## Implementation
Implementation notes.
`;
    const chunks = chunkMarkdown('docs/design.md', content);
    expect(chunks.length).toBe(3);
    expect(chunks[0].content).toContain('Introduction');
    expect(chunks[1].content).toContain('Design');
    expect(chunks[2].content).toContain('Implementation');
    expect(chunks[0].chunkType).toBe('markdown');
    expect(chunks[0].filePath).toBe('docs/design.md');
  });

  it('returns empty for blank content', () => {
    const chunks = chunkMarkdown('empty.md', '');
    expect(chunks.length).toBe(0);
  });

  it('handles content with no headings as single chunk', () => {
    const chunks = chunkMarkdown('notes.md', 'Just some text without headings.');
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain('Just some text');
  });

  it('splits long sections with sliding window', () => {
    // Create a section longer than 512 chars
    const longText = '# Long Section\n' + 'x'.repeat(800);
    const chunks = chunkMarkdown('long.md', longText);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be <= 512 chars
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(512);
    }
  });
});

// ---------------------------------------------------------------------------
// chunkCodeEntities
// ---------------------------------------------------------------------------

describe('chunkCodeEntities', () => {
  it('creates a chunk per declaration', () => {
    const chunks = chunkCodeEntities('src/engine.ts', [
      {
        id: 'decl1',
        name: 'createIssue',
        kind: 'function',
        signature: 'function createIssue(title: string): void',
        docComment: '/** Create a new issue */',
      },
      {
        id: 'decl2',
        name: 'TrellisEngine',
        kind: 'class',
        signature: 'class TrellisEngine',
      },
    ]);
    expect(chunks.length).toBe(2);
    expect(chunks[0].chunkType).toBe('code_entity');
    expect(chunks[0].content).toContain('createIssue');
    expect(chunks[0].content).toContain('Create a new issue');
    expect(chunks[0].entityId).toBe('symbol:src/engine.ts#createIssue');
    expect(chunks[1].content).toContain('TrellisEngine');
  });

  it('returns empty for no declarations', () => {
    const chunks = chunkCodeEntities('src/empty.ts', []);
    expect(chunks.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// chunkDocComments
// ---------------------------------------------------------------------------

describe('chunkDocComments', () => {
  it('creates a chunk per doc comment', () => {
    const chunks = chunkDocComments('src/auth.ts', [
      { line: 10, text: '/** Authenticate user with JWT token */' },
      { line: 30, text: '/** Validate refresh token */' },
    ]);
    expect(chunks.length).toBe(2);
    expect(chunks[0].chunkType).toBe('doc_comment');
    expect(chunks[0].content).toContain('JWT token');
    expect(chunks[1].content).toContain('refresh token');
  });

  it('skips blank comments', () => {
    const chunks = chunkDocComments('src/auth.ts', [
      { line: 1, text: '' },
      { line: 5, text: '   ' },
      { line: 10, text: '/** Real comment */' },
    ]);
    expect(chunks.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// chunkSummary
// ---------------------------------------------------------------------------

describe('chunkSummary', () => {
  it('creates a single chunk for short summaries', () => {
    const chunks = chunkSummary('summary.md', 'Brief summary of this feature.');
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkType).toBe('summary_md');
  });

  it('splits long summaries by headings', () => {
    const content = '# Overview\n' + 'x'.repeat(400) + '\n# Details\n' + 'y'.repeat(400);
    const chunks = chunkSummary('summary.md', content);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => c.chunkType === 'summary_md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// chunkFile (auto-detect)
// ---------------------------------------------------------------------------

describe('chunkFile', () => {
  it('routes .md files to markdown chunker', () => {
    const chunks = chunkFile('docs/guide.md', '# Guide\nSome content.');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chunkType).toBe('markdown');
  });

  it('routes summary.md to summary chunker', () => {
    const chunks = chunkFile('summary.md', 'Brief summary.');
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkType).toBe('summary_md');
  });

  it('returns empty for source files (code entities handled separately)', () => {
    const chunks = chunkFile('src/engine.ts', 'export function foo() {}');
    expect(chunks.length).toBe(0);
  });

  it('returns empty for blank content', () => {
    const chunks = chunkFile('empty.md', '');
    expect(chunks.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// slidingWindow
// ---------------------------------------------------------------------------

describe('slidingWindow', () => {
  it('returns single window for short text', () => {
    const windows = slidingWindow('Short text');
    expect(windows.length).toBe(1);
    expect(windows[0]).toBe('Short text');
  });

  it('splits long text with overlap', () => {
    const text = 'a'.repeat(1000);
    const windows = slidingWindow(text);
    expect(windows.length).toBeGreaterThan(1);
    // Windows should overlap
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].length).toBeGreaterThan(0);
    }
  });

  it('covers the entire text', () => {
    const text = 'a'.repeat(1200);
    const windows = slidingWindow(text);
    // Last window should include the end of the text
    const lastWindow = windows[windows.length - 1];
    expect(lastWindow[lastWindow.length - 1]).toBe('a');
  });
});

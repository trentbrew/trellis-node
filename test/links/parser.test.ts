/**
 * Wiki-Link Parser Tests
 *
 * @see TRL-11
 */

import { describe, it, expect } from 'vitest';
import {
  parseFileRefs,
  parseMarkdownRefs,
  parseDocCommentRefs,
  parseRefContent,
  inferNamespace,
} from '../../src/links/parser.js';

// ---------------------------------------------------------------------------
// parseRefContent — unit tests for inner content parsing
// ---------------------------------------------------------------------------

describe('parseRefContent', () => {
  it('parses explicit namespace: issue:TRL-5', () => {
    const r = parseRefContent('issue:TRL-5');
    expect(r).toEqual({ namespace: 'issue', target: 'TRL-5', anchor: undefined, alias: undefined });
  });

  it('parses explicit namespace with alias: issue:TRL-5|the parser ticket', () => {
    const r = parseRefContent('issue:TRL-5|the parser ticket');
    expect(r).toEqual({ namespace: 'issue', target: 'TRL-5', anchor: undefined, alias: 'the parser ticket' });
  });

  it('parses explicit namespace with anchor: symbol:src/engine.ts#createIssue', () => {
    const r = parseRefContent('symbol:src/engine.ts#createIssue');
    expect(r).toEqual({ namespace: 'symbol', target: 'src/engine.ts', anchor: 'createIssue', alias: undefined });
  });

  it('parses explicit namespace with anchor and alias: symbol:src/engine.ts#createIssue|create fn', () => {
    const r = parseRefContent('symbol:src/engine.ts#createIssue|create fn');
    expect(r).toEqual({ namespace: 'symbol', target: 'src/engine.ts', anchor: 'createIssue', alias: 'create fn' });
  });

  it('parses all explicit namespaces', () => {
    expect(parseRefContent('file:src/engine.ts')?.namespace).toBe('file');
    expect(parseRefContent('identity:trentbrew')?.namespace).toBe('identity');
    expect(parseRefContent('milestone:v0.2.0')?.namespace).toBe('milestone');
    expect(parseRefContent('decision:DEC-1')?.namespace).toBe('decision');
  });

  // --- Bare refs with smart inference ---

  it('infers issue namespace from TRL-N pattern', () => {
    const r = parseRefContent('TRL-5');
    expect(r).toEqual({ namespace: 'issue', target: 'TRL-5', anchor: undefined, alias: undefined });
  });

  it('infers issue namespace case-insensitively', () => {
    expect(parseRefContent('trl-42')?.namespace).toBe('issue');
  });

  it('infers decision namespace from DEC-N pattern', () => {
    const r = parseRefContent('DEC-1');
    expect(r).toEqual({ namespace: 'decision', target: 'DEC-1', anchor: undefined, alias: undefined });
  });

  it('infers symbol namespace when anchor is present', () => {
    const r = parseRefContent('src/engine.ts#createIssue');
    expect(r).toEqual({ namespace: 'symbol', target: 'src/engine.ts', anchor: 'createIssue', alias: undefined });
  });

  it('infers file namespace from path with slash', () => {
    const r = parseRefContent('src/engine.ts');
    expect(r).toEqual({ namespace: 'file', target: 'src/engine.ts', anchor: undefined, alias: undefined });
  });

  it('infers file namespace from known extension', () => {
    const r = parseRefContent('README.md');
    expect(r).toEqual({ namespace: 'file', target: 'README.md', anchor: undefined, alias: undefined });
  });

  it('returns null for ambiguous bare refs', () => {
    expect(parseRefContent('trentbrew')).toBeNull();
    expect(parseRefContent('v0.2.0')).toBeNull();
    expect(parseRefContent('someRandomString')).toBeNull();
  });

  it('returns null for empty or whitespace', () => {
    expect(parseRefContent('')).toBeNull();
    expect(parseRefContent('  ')).toBeNull();
  });

  it('handles bare ref with alias', () => {
    const r = parseRefContent('TRL-5|the parser ticket');
    expect(r).toEqual({ namespace: 'issue', target: 'TRL-5', anchor: undefined, alias: 'the parser ticket' });
  });
});

// ---------------------------------------------------------------------------
// inferNamespace — unit tests
// ---------------------------------------------------------------------------

describe('inferNamespace', () => {
  it('returns issue for TRL-N pattern', () => {
    expect(inferNamespace('TRL-1')).toBe('issue');
    expect(inferNamespace('TRL-999')).toBe('issue');
  });

  it('returns decision for DEC-N pattern', () => {
    expect(inferNamespace('DEC-1')).toBe('decision');
    expect(inferNamespace('DEC-42')).toBe('decision');
  });

  it('returns symbol when anchor is present', () => {
    expect(inferNamespace('src/engine.ts', 'createIssue')).toBe('symbol');
  });

  it('returns file for paths with slash', () => {
    expect(inferNamespace('src/engine.ts')).toBe('file');
    expect(inferNamespace('lib/utils/helper.py')).toBe('file');
  });

  it('returns file for known extensions', () => {
    expect(inferNamespace('engine.ts')).toBe('file');
    expect(inferNamespace('parser.py')).toBe('file');
    expect(inferNamespace('main.go')).toBe('file');
    expect(inferNamespace('lib.rs')).toBe('file');
    expect(inferNamespace('README.md')).toBe('file');
  });

  it('returns null for ambiguous strings', () => {
    expect(inferNamespace('trentbrew')).toBeNull();
    expect(inferNamespace('v0.2.0')).toBeNull();
    expect(inferNamespace('something')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseMarkdownRefs — full markdown parsing
// ---------------------------------------------------------------------------

describe('parseMarkdownRefs', () => {
  it('extracts single ref from markdown', () => {
    const md = 'See [[TRL-5]] for details.';
    const refs = parseMarkdownRefs(md, 'docs/notes.md');
    expect(refs).toHaveLength(1);
    expect(refs[0].namespace).toBe('issue');
    expect(refs[0].target).toBe('TRL-5');
    expect(refs[0].source.filePath).toBe('docs/notes.md');
    expect(refs[0].source.line).toBe(1);
    expect(refs[0].source.context).toBe('markdown');
  });

  it('extracts multiple refs from same line', () => {
    const md = 'Both [[TRL-5]] and [[TRL-6]] are related.';
    const refs = parseMarkdownRefs(md, 'notes.md');
    expect(refs).toHaveLength(2);
    expect(refs[0].target).toBe('TRL-5');
    expect(refs[1].target).toBe('TRL-6');
  });

  it('extracts refs from multiple lines', () => {
    const md = `# Design
See [[src/engine.ts]] for the main module.

## Issues
- [[TRL-5]] parser
- [[TRL-6]] go parser
`;
    const refs = parseMarkdownRefs(md, 'DESIGN.md');
    expect(refs).toHaveLength(3);
    expect(refs[0].namespace).toBe('file');
    expect(refs[0].source.line).toBe(2);
    expect(refs[1].namespace).toBe('issue');
    expect(refs[1].source.line).toBe(5);
    expect(refs[2].namespace).toBe('issue');
    expect(refs[2].source.line).toBe(6);
  });

  it('handles namespaced refs in markdown', () => {
    const md = 'Check [[identity:trentbrew]] and [[milestone:v0.2.0]].';
    const refs = parseMarkdownRefs(md, 'notes.md');
    expect(refs).toHaveLength(2);
    expect(refs[0].namespace).toBe('identity');
    expect(refs[0].target).toBe('trentbrew');
    expect(refs[1].namespace).toBe('milestone');
    expect(refs[1].target).toBe('v0.2.0');
  });

  it('handles refs with aliases', () => {
    const md = 'See [[TRL-5|the parser ticket]] for context.';
    const refs = parseMarkdownRefs(md, 'notes.md');
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBe('TRL-5');
    expect(refs[0].alias).toBe('the parser ticket');
  });

  it('handles symbol refs with anchors', () => {
    const md = 'The [[src/engine.ts#createIssue]] function handles this.';
    const refs = parseMarkdownRefs(md, 'notes.md');
    expect(refs).toHaveLength(1);
    expect(refs[0].namespace).toBe('symbol');
    expect(refs[0].target).toBe('src/engine.ts');
    expect(refs[0].anchor).toBe('createIssue');
  });

  it('skips ambiguous bare refs', () => {
    const md = 'Talk to [[trentbrew]] about this.';
    const refs = parseMarkdownRefs(md, 'notes.md');
    expect(refs).toHaveLength(0);
  });

  it('returns empty for content with no refs', () => {
    const md = 'No wiki links here. Just regular [markdown](links).';
    const refs = parseMarkdownRefs(md, 'notes.md');
    expect(refs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseDocCommentRefs — doc-comment extraction
// ---------------------------------------------------------------------------

describe('parseDocCommentRefs', () => {
  it('extracts refs from JSDoc comments', () => {
    const ts = `
/**
 * Create an issue in the tracker.
 * See [[TRL-11]] for the spec.
 * Uses [[src/vcs/types.ts#VcsPayload]].
 */
export function createIssue() {}
`;
    const refs = parseDocCommentRefs(ts, 'src/engine.ts', 'ts');
    expect(refs).toHaveLength(2);
    expect(refs[0].namespace).toBe('issue');
    expect(refs[0].target).toBe('TRL-11');
    expect(refs[0].source.context).toBe('jsdoc');
    expect(refs[1].namespace).toBe('symbol');
    expect(refs[1].target).toBe('src/vcs/types.ts');
    expect(refs[1].anchor).toBe('VcsPayload');
  });

  it('extracts refs from single-line // comments', () => {
    const ts = `
// See [[TRL-5]] for context
const x = 42;
`;
    const refs = parseDocCommentRefs(ts, 'src/foo.ts', 'ts');
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBe('TRL-5');
    expect(refs[0].source.context).toBe('comment');
  });

  it('extracts refs from Python docstrings', () => {
    const py = `
def create_issue():
    """
    Create an issue in the tracker.
    See [[TRL-11]] for the spec.
    """
    pass
`;
    const refs = parseDocCommentRefs(py, 'src/engine.py', 'py');
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBe('TRL-11');
    expect(refs[0].source.context).toBe('pydoc');
  });

  it('extracts refs from Python # comments', () => {
    const py = `
# See [[TRL-5]] for more info
x = 42
`;
    const refs = parseDocCommentRefs(py, 'src/foo.py', 'py');
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBe('TRL-5');
    expect(refs[0].source.context).toBe('comment');
  });

  it('extracts refs from Rust doc-comments', () => {
    const rs = `
/// Creates an issue. See [[TRL-11]].
pub fn create_issue() {}
`;
    const refs = parseDocCommentRefs(rs, 'src/engine.rs', 'rs');
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBe('TRL-11');
    expect(refs[0].source.context).toBe('rustdoc');
  });

  it('extracts refs from Go doc-comments', () => {
    const go = `
// CreateIssue creates an issue. See [[TRL-11]].
func CreateIssue() {}
`;
    const refs = parseDocCommentRefs(go, 'src/engine.go', 'go');
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBe('TRL-11');
    expect(refs[0].source.context).toBe('godoc');
  });

  it('does not extract refs from non-comment code', () => {
    const ts = `
const msg = "See [[TRL-5]] in a string";
const arr = [["not", "a", "ref"]];
`;
    const refs = parseDocCommentRefs(ts, 'src/foo.ts', 'ts');
    expect(refs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseFileRefs — unified entry point
// ---------------------------------------------------------------------------

describe('parseFileRefs', () => {
  it('routes .md files to markdown parser', () => {
    const md = 'See [[TRL-5]].';
    const refs = parseFileRefs(md, 'docs/notes.md');
    expect(refs).toHaveLength(1);
    expect(refs[0].source.context).toBe('markdown');
  });

  it('routes .ts files to doc-comment parser', () => {
    const ts = `
/** See [[TRL-5]] */
export function foo() {}
`;
    const refs = parseFileRefs(ts, 'src/foo.ts');
    expect(refs).toHaveLength(1);
    expect(refs[0].source.context).toBe('jsdoc');
  });

  it('routes .py files to doc-comment parser', () => {
    const py = `
# See [[TRL-5]]
x = 1
`;
    const refs = parseFileRefs(py, 'src/foo.py');
    expect(refs).toHaveLength(1);
  });

  it('returns empty for unknown extensions', () => {
    const txt = 'See [[TRL-5]].';
    const refs = parseFileRefs(txt, 'data/notes.txt');
    expect(refs).toHaveLength(0);
  });
});

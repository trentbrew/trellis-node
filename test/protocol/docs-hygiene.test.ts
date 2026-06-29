import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('protocol docs hygiene (TRL-40 manual AC)', () => {
  test('ADR 0015 exists with Status Accepted', () => {
    const adr = join(REPO_ROOT, 'docs/adr/0015-agent-handoff-protocol.md');
    expect(existsSync(adr)).toBe(true);
    const text = readFileSync(adr, 'utf-8');
    expect(text).toContain('**Status:** Accepted');
  });

  test('write.ts lane docs use escaped backticks in template literal', () => {
    const writeTs = readFileSync(join(REPO_ROOT, 'src/scaffold/write.ts'), 'utf-8');
    expect(writeTs).toMatch(
      /Multi-agent lanes.*\\`trellis issue start\\`/,
    );
    expect(writeTs).not.toMatch(
      /Multi-agent lanes.*use `trellis issue start`/,
    );
  });
});

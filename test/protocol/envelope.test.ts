import { describe, test, expect } from 'vitest';
import {
  parseEnvelope,
  validateEnvelope,
  formatEnvelope,
  formatTurnBanner,
  formatIssueDescription,
} from '../../src/protocol/envelope.js';

const SAMPLE = `Some prose above.

🟢 TURN executor · stage impl · HANDOFF · TRL-41
---
from: architect
to: executor
re: TRL-41
status: HANDOFF
body: |
  Spec ready. AC 1–9 on issue.
`;

describe('protocol envelope', () => {
  test('parseEnvelope extracts footer fields', () => {
    const env = parseEnvelope(SAMPLE);
    expect(env.from).toBe('architect');
    expect(env.to).toBe('executor');
    expect(env.re).toBe('TRL-41');
    expect(env.status).toBe('HANDOFF');
    expect(env.body).toContain('Spec ready');
  });

  test('validateEnvelope rejects invalid role', () => {
    const result = validateEnvelope({
      from: 'bogus',
      to: 'executor',
      re: 'TRL-1',
      status: 'HANDOFF',
    });
    expect(result.ok).toBe(false);
  });

  test('validateEnvelope rejects invalid re', () => {
    const result = validateEnvelope({
      from: 'architect',
      to: 'executor',
      re: 'not-an-issue',
      status: 'HANDOFF',
    });
    expect(result.ok).toBe(false);
  });

  test('formatEnvelope round-trips required fields', () => {
    const env = parseEnvelope(SAMPLE);
    const yaml = formatEnvelope(env);
    expect(yaml).toContain('from: architect');
    expect(yaml).toContain('status: HANDOFF');
  });

  test('formatTurnBanner matches handoffs skill shape', () => {
    const env = parseEnvelope(SAMPLE);
    expect(formatTurnBanner(env, 'impl')).toBe(
      '🟢 TURN executor · stage impl · HANDOFF · TRL-41',
    );
  });

  test('formatIssueDescription includes banner and yaml', () => {
    const env = parseEnvelope(SAMPLE);
    const desc = formatIssueDescription(env, 'impl');
    expect(desc).toContain('TURN executor');
    expect(desc).toContain('---');
    expect(desc).toContain('from: architect');
  });
});

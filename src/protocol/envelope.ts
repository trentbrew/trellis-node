/**
 * trellis-handoffs envelope — parse, validate, serialize.
 */

export const HANDOFF_ROLES = [
  'strategist',
  'designer',
  'architect',
  'executor',
  'reviewer',
  'optimizer',
  'synthesist',
  'writer',
  'human',
] as const;

export type HandoffRole = (typeof HANDOFF_ROLES)[number];

export const HANDOFF_STATUSES = [
  'HANDOFF',
  'CLARIFY',
  'REJECT',
  'BLOCKED',
  'DECISION',
] as const;

export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export interface HandoffEnvelope {
  from: HandoffRole;
  to: HandoffRole;
  re: string;
  status: HandoffStatus;
  body?: string;
  refs?: string[];
  in_reply_to?: string;
}

const ROLE_SET = new Set<string>(HANDOFF_ROLES);
const STATUS_SET = new Set<string>(HANDOFF_STATUSES);

const ROLE_BALL: Record<HandoffRole, string> = {
  strategist: '🟣',
  designer: '🟠',
  architect: '🔵',
  executor: '🟢',
  reviewer: '🟡',
  optimizer: '⚡',
  synthesist: '🎨',
  writer: '✍️',
  human: '⚪',
};

function parseYamlFields(yaml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  let currentKey: string | null = null;
  let bodyLines: string[] = [];
  let inBody = false;

  const flushBody = () => {
    if (currentKey && inBody) {
      result[currentKey] = bodyLines.join('\n').replace(/\n$/, '');
      inBody = false;
      bodyLines = [];
    }
  };

  for (const line of lines) {
    if (inBody) {
      if (line.startsWith('  ') || line === '') {
        bodyLines.push(line.startsWith('  ') ? line.slice(2) : '');
        continue;
      }
      flushBody();
    }

    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) continue;

    currentKey = kv[1];
    const rest = kv[2];
    if (rest === '|') {
      inBody = true;
      bodyLines = [];
    } else {
      result[currentKey] = rest.trim();
    }
  }

  flushBody();
  return result;
}

export function extractYamlFooter(text: string): string | null {
  const normalized = text.replace(/\r\n/g, '\n');
  const idx = normalized.lastIndexOf('\n---\n');
  if (idx === -1) {
    if (normalized.startsWith('---\n')) {
      return normalized.slice(4);
    }
    return null;
  }
  return normalized.slice(idx + 5);
}

export function parseEnvelope(text: string): HandoffEnvelope {
  const yaml = extractYamlFooter(text);
  if (!yaml) {
    throw new Error('No handoff envelope found (expected --- YAML footer)');
  }

  const fields = parseYamlFields(yaml);
  if (!fields.from || !fields.to || !fields.re || !fields.status) {
    throw new Error('Envelope missing required fields: from, to, re, status');
  }

  const env: HandoffEnvelope = {
    from: fields.from as HandoffRole,
    to: fields.to as HandoffRole,
    re: fields.re,
    status: fields.status as HandoffStatus,
  };

  if (fields.body) env.body = fields.body;
  if (fields.in_reply_to) env.in_reply_to = fields.in_reply_to;
  if (fields.refs) {
    env.refs = fields.refs
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
  }

  const validation = validateEnvelope(env);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }

  return env;
}

export function validateEnvelope(
  env: HandoffEnvelope,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!ROLE_SET.has(env.from)) {
    errors.push(`invalid from role: ${env.from}`);
  }
  if (!ROLE_SET.has(env.to)) {
    errors.push(`invalid to role: ${env.to}`);
  }
  if (!STATUS_SET.has(env.status)) {
    errors.push(`invalid status: ${env.status}`);
  }
  if (!env.re?.trim()) {
    errors.push('re is required');
  } else if (!/^TRL-\d+/.test(env.re.trim())) {
    errors.push(`re must start with TRL-N issue ref, got: ${env.re}`);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function formatEnvelope(env: HandoffEnvelope): string {
  const lines = [
    '---',
    `from: ${env.from}`,
    `to: ${env.to}`,
    `re: ${env.re}`,
    `status: ${env.status}`,
  ];

  if (env.body !== undefined) {
    if (env.body.includes('\n')) {
      lines.push('body: |', ...env.body.split('\n').map((l) => `  ${l}`));
    } else {
      lines.push(`body: ${env.body}`);
    }
  }
  if (env.refs?.length) {
    lines.push(`refs: ${env.refs.join(', ')}`);
  }
  if (env.in_reply_to) {
    lines.push(`in_reply_to: ${env.in_reply_to}`);
  }

  return lines.join('\n');
}

export function formatTurnBanner(
  env: HandoffEnvelope,
  stage?: string,
): string {
  const ball = ROLE_BALL[env.to] ?? '⚪';
  const stagePart = stage ? ` · stage ${stage}` : '';
  return `${ball} TURN ${env.to}${stagePart} · ${env.status} · ${env.re}`;
}

export function formatIssueDescription(
  env: HandoffEnvelope,
  stage?: string,
): string {
  return `${formatTurnBanner(env, stage)}\n${formatEnvelope(env)}`;
}

export function isWaitingOnHuman(env: HandoffEnvelope): boolean {
  return env.to === 'human';
}

export function tryParseEnvelope(
  description?: string,
): HandoffEnvelope | undefined {
  if (!description?.includes('from:')) return undefined;
  try {
    return parseEnvelope(description);
  } catch {
    return undefined;
  }
}

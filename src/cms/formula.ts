import type { Entry, FieldDefinition } from './types.js';

const OPS = new Set(['+', '-', '*', '/', '(', ')']);

type Token = number | '+' | '-' | '*' | '/' | '(' | ')';

function num(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function tokenize(expr: string): Token[] | undefined {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (OPS.has(ch)) {
      tokens.push(ch as Token);
      i++;
      continue;
    }
    if (/\d|\./.test(ch)) {
      let end = i + 1;
      while (end < expr.length && /\d|\./.test(expr[end]!)) end++;
      const value = Number(expr.slice(i, end));
      if (!Number.isFinite(value)) return undefined;
      tokens.push(value);
      i = end;
      continue;
    }
    return undefined;
  }
  return tokens;
}

function parse(tokens: Token[]): number | undefined {
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];

  const primary = (): number | undefined => {
    const token = take();
    if (typeof token === 'number') return token;
    if (token === '+') return primary();
    if (token === '-') {
      const value = primary();
      return value === undefined ? undefined : -value;
    }
    if (token === '(') {
      const value = add();
      if (take() !== ')') return undefined;
      return value;
    }
    return undefined;
  };

  const mul = (): number | undefined => {
    let left = primary();
    while (peek() === '*' || peek() === '/') {
      const op = take();
      const right = primary();
      if (left === undefined || right === undefined) return undefined;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  };

  const add = (): number | undefined => {
    let left = mul();
    while (peek() === '+' || peek() === '-') {
      const op = take();
      const right = mul();
      if (left === undefined || right === undefined) return undefined;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const value = add();
  if (i !== tokens.length || value === undefined || !Number.isFinite(value))
    return undefined;
  return value;
}

export function evaluateFormula(
  expr: string,
  fields: Record<string, unknown>,
): number | undefined {
  const interpolated = expr.replace(/\{([^{}]+)\}/g, (match, key: string) => {
    const value = num(fields[key.trim()]);
    return value === undefined ? match : String(value);
  });
  if (interpolated.includes('{') || interpolated.includes('}'))
    return undefined;
  const tokens = tokenize(interpolated);
  return tokens ? parse(tokens) : undefined;
}

function keys(value: string): string[] {
  const raw = value.replace(/^schema:/, '').trim();
  const camel = raw.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  const lower = raw.toLowerCase().replace(/\s+/g, '_');
  const snake = camel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const compact = lower.replace(/[^a-z0-9]+/g, '');
  return [...new Set([lower, snake, compact].filter(Boolean))];
}

export function parseFields(raw: unknown): FieldDefinition[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is FieldDefinition => {
      if (!item || typeof item !== 'object') return false;
      const def = item as Record<string, unknown>;
      return typeof def.key === 'string' && typeof def.type === 'string';
    });
  } catch {
    return [];
  }
}

export function schemaFields(
  facts: { e: string; a: string; v: unknown }[],
  names: string[],
): FieldDefinition[] {
  const wanted = new Set(names.flatMap(keys));
  const fact = facts.find(
    (item) =>
      item.e.startsWith('schema:') &&
      item.a === 'props' &&
      keys(item.e).some((key) => wanted.has(key)),
  );
  return parseFields(fact?.v);
}

export function applyFormulas<T extends Record<string, unknown>>(
  entry: Entry<T>,
  defs: FieldDefinition[],
): Entry<T> {
  const formulas = defs.filter(
    (def) =>
      def.type === 'formula' &&
      typeof def.formula === 'string' &&
      def.formula.trim(),
  );
  if (formulas.length === 0) return entry;
  const fields: Record<string, unknown> = { ...entry.fields };
  for (let pass = 0; pass < formulas.length; pass++) {
    for (const def of formulas)
      fields[def.key] = evaluateFormula(def.formula!, fields);
  }
  return { ...entry, fields: fields as T };
}

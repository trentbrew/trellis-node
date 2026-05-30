/**
 * EQL-S Query Parser — Parses a simple DSL into Query AST.
 *
 * Syntax overview:
 *   SELECT ?e ?name
 *   WHERE {
 *     [?e "type" "Project"]
 *     [?e "name" ?name]
 *     (?e "memberOf" ?org)
 *   }
 *   FILTER ?name != "archived"
 *   ORDER BY ?name ASC
 *   LIMIT 10
 *   OFFSET 5
 *
 * Fact patterns: [entity attr value]
 * Link patterns: (source attr target)
 * Not patterns:  NOT [entity attr value]
 * Or patterns:   OR { branch1 } { branch2 }
 * Rule calls:    ruleName(?x, ?y)
 *
 * Variables start with `?`. Strings are double-quoted.
 * Numbers are bare. Booleans: true/false.
 *
 * @module trellis/core/query
 */

import type {
  Query, Pattern, FactPattern, LinkPattern, NotPattern, OrPattern,
  RuleApplication, Filter, FilterOp, Aggregate, AggregateOp, OrderBy,
  Term, DatalogRule,
} from './types.js';
import { variable, literal } from './types.js';

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenKind = 'word' | 'string' | 'number' | 'symbol' | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) { i++; continue; }

    // Skip comments (// to end of line)
    if (input[i] === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }

    const pos = i;

    // Symbols
    if ('[](){},:'.includes(input[i])) {
      tokens.push({ kind: 'symbol', value: input[i], pos });
      i++;
      continue;
    }

    // Multi-char operators
    if (input[i] === '!' && input[i + 1] === '=') {
      tokens.push({ kind: 'symbol', value: '!=', pos });
      i += 2;
      continue;
    }
    if (input[i] === '<' && input[i + 1] === '=') {
      tokens.push({ kind: 'symbol', value: '<=', pos });
      i += 2;
      continue;
    }
    if (input[i] === '>' && input[i + 1] === '=') {
      tokens.push({ kind: 'symbol', value: '>=', pos });
      i += 2;
      continue;
    }
    if ('<>='.includes(input[i])) {
      tokens.push({ kind: 'symbol', value: input[i], pos });
      i++;
      continue;
    }

    // Strings
    if (input[i] === '"') {
      i++;
      let s = '';
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          s += input[i + 1]; i += 2;
        } else {
          s += input[i]; i++;
        }
      }
      if (i < input.length) i++; // skip closing "
      tokens.push({ kind: 'string', value: s, pos });
      continue;
    }

    // Numbers (including negative)
    if (/[0-9]/.test(input[i]) || (input[i] === '-' && i + 1 < input.length && /[0-9]/.test(input[i + 1]))) {
      let n = input[i]; i++;
      while (i < input.length && /[0-9.]/.test(input[i])) { n += input[i]; i++; }
      tokens.push({ kind: 'number', value: n, pos });
      continue;
    }

    // Words (identifiers, variables, keywords)
    if (/[?a-zA-Z_]/.test(input[i])) {
      let w = ''; 
      while (i < input.length && /[?a-zA-Z0-9_.:/-]/.test(input[i])) { w += input[i]; i++; }
      tokens.push({ kind: 'word', value: w, pos });
      continue;
    }

    // Unknown char — skip
    i++;
  }

  tokens.push({ kind: 'eof', value: '', pos: input.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private advance(): Token { return this.tokens[this.pos++]; }

  private expect(kind: TokenKind, value?: string): Token {
    const t = this.advance();
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new Error(`Expected ${kind}${value ? ` "${value}"` : ''} at pos ${t.pos}, got ${t.kind} "${t.value}"`);
    }
    return t;
  }

  private match(kind: TokenKind, value?: string): boolean {
    const t = this.peek();
    if (t.kind === kind && (value === undefined || t.value === value)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private isAt(kind: TokenKind, value?: string): boolean {
    const t = this.peek();
    return t.kind === kind && (value === undefined || t.value === value);
  }

  // -----------------------------------------------------------------------
  // Terms
  // -----------------------------------------------------------------------

  parseTerm(): Term {
    const t = this.peek();
    if (t.kind === 'word' && t.value.startsWith('?')) {
      this.advance();
      return variable(t.value.slice(1));
    }
    if (t.kind === 'string') {
      this.advance();
      return literal(t.value);
    }
    if (t.kind === 'number') {
      this.advance();
      const n = Number(t.value);
      return literal(n);
    }
    if (t.kind === 'word') {
      const v = t.value;
      this.advance();
      if (v === 'true') return literal(true);
      if (v === 'false') return literal(false);
      return literal(v);
    }
    throw new Error(`Unexpected token at pos ${t.pos}: ${t.kind} "${t.value}"`);
  }

  // -----------------------------------------------------------------------
  // Patterns
  // -----------------------------------------------------------------------

  parsePattern(): Pattern {
    const t = this.peek();

    // NOT pattern
    if (t.kind === 'word' && t.value.toUpperCase() === 'NOT') {
      this.advance();
      const inner = this.parsePattern();
      return { kind: 'not', pattern: inner } as NotPattern;
    }

    // OR pattern
    if (t.kind === 'word' && t.value.toUpperCase() === 'OR') {
      this.advance();
      const branches: Pattern[][] = [];
      while (this.isAt('symbol', '{')) {
        this.advance();
        const branch: Pattern[] = [];
        while (!this.isAt('symbol', '}') && !this.isAt('eof', undefined)) {
          branch.push(this.parsePattern());
        }
        this.expect('symbol', '}');
        branches.push(branch);
      }
      return { kind: 'or', branches } as OrPattern;
    }

    // Fact pattern: [e a v]
    if (t.kind === 'symbol' && t.value === '[') {
      this.advance();
      const entity = this.parseTerm();
      const attribute = this.parseTerm();
      const value = this.parseTerm();
      this.expect('symbol', ']');
      return { kind: 'fact', entity, attribute, value } as FactPattern;
    }

    // Link pattern: (src a tgt)
    if (t.kind === 'symbol' && t.value === '(') {
      this.advance();
      const source = this.parseTerm();
      const attribute = this.parseTerm();
      const target = this.parseTerm();
      this.expect('symbol', ')');
      return { kind: 'link', source, attribute, target } as LinkPattern;
    }

    // Rule application: ruleName(?x, ?y)
    if (t.kind === 'word' && !t.value.startsWith('?')) {
      const name = this.advance().value;
      if (this.isAt('symbol', '(')) {
        this.advance();
        const args: Term[] = [];
        while (!this.isAt('symbol', ')') && !this.isAt('eof', undefined)) {
          args.push(this.parseTerm());
          this.match('symbol', ',');
        }
        this.expect('symbol', ')');
        return { kind: 'rule', name, args } as RuleApplication;
      }
      throw new Error(`Expected '(' after rule name "${name}" at pos ${t.pos}`);
    }

    throw new Error(`Cannot parse pattern at pos ${t.pos}: ${t.kind} "${t.value}"`);
  }

  // -----------------------------------------------------------------------
  // Filter
  // -----------------------------------------------------------------------

  parseFilter(): Filter {
    const left = this.parseTerm();
    const op = this.advance().value as FilterOp;
    const right = this.parseTerm();
    return { kind: 'filter', left, op, right };
  }

  // -----------------------------------------------------------------------
  // Full Query
  // -----------------------------------------------------------------------

  parseQuery(): Query {
    const query: Query = {
      select: [],
      where: [],
      filters: [],
      aggregates: [],
      orderBy: [],
      limit: 0,
      offset: 0,
    };

    // Parse clauses in any order
    while (!this.isAt('eof', undefined)) {
      const kw = this.peek();
      if (kw.kind !== 'word') {
        throw new Error(`Expected keyword at pos ${kw.pos}, got ${kw.kind} "${kw.value}"`);
      }

      switch (kw.value.toUpperCase()) {
        case 'SELECT': {
          this.advance();
          while (this.peek().kind === 'word' && this.peek().value.startsWith('?')) {
            query.select.push(this.advance().value.slice(1));
          }
          break;
        }

        case 'WHERE': {
          this.advance();
          this.expect('symbol', '{');
          while (!this.isAt('symbol', '}') && !this.isAt('eof', undefined)) {
            query.where.push(this.parsePattern());
          }
          this.expect('symbol', '}');
          break;
        }

        case 'FILTER': {
          this.advance();
          query.filters.push(this.parseFilter());
          break;
        }

        case 'AGGREGATE': {
          this.advance();
          const op = this.advance().value as AggregateOp;
          this.expect('symbol', '(');
          const varName = this.advance().value;
          const varClean = varName.startsWith('?') ? varName.slice(1) : varName;
          this.expect('symbol', ')');
          this.expect('word', 'AS');
          const asName = this.advance().value;
          const asClean = asName.startsWith('?') ? asName.slice(1) : asName;
          query.aggregates.push({ op, variable: varClean, as: asClean });
          break;
        }

        case 'ORDER': {
          this.advance();
          this.expect('word', 'BY');
          while (this.peek().kind === 'word' && this.peek().value.startsWith('?')) {
            const v = this.advance().value.slice(1);
            let dir: 'asc' | 'desc' = 'asc';
            if (this.peek().kind === 'word' && ['ASC', 'DESC'].includes(this.peek().value.toUpperCase())) {
              dir = this.advance().value.toLowerCase() as 'asc' | 'desc';
            }
            query.orderBy.push({ variable: v, direction: dir });
          }
          break;
        }

        case 'LIMIT': {
          this.advance();
          query.limit = Number(this.expect('number').value);
          break;
        }

        case 'OFFSET': {
          this.advance();
          query.offset = Number(this.expect('number').value);
          break;
        }

        default:
          throw new Error(`Unknown keyword "${kw.value}" at pos ${kw.pos}`);
      }
    }

    return query;
  }

  // -----------------------------------------------------------------------
  // Datalog Rule
  // -----------------------------------------------------------------------

  parseRule(): DatalogRule {
    // name(?x, ?y) :- body
    const name = this.expect('word').value;
    this.expect('symbol', '(');
    const params: string[] = [];
    while (!this.isAt('symbol', ')') && !this.isAt('eof', undefined)) {
      const v = this.expect('word').value;
      params.push(v.startsWith('?') ? v.slice(1) : v);
      this.match('symbol', ',');
    }
    this.expect('symbol', ')');

    // :- separator (colon + minus as two tokens, or we accept ":-" as word)
    if (this.isAt('symbol', ':')) {
      this.advance();
      // Accept - as a word or skip
      if (this.peek().kind === 'number' && this.peek().value.startsWith('-')) {
        this.advance();
      }
    } else if (this.isAt('word', ':-')) {
      this.advance();
    }

    const body: Pattern[] = [];
    const filters: Filter[] = [];

    while (!this.isAt('eof', undefined)) {
      if (this.peek().kind === 'word' && this.peek().value.toUpperCase() === 'FILTER') {
        this.advance();
        filters.push(this.parseFilter());
      } else {
        body.push(this.parsePattern());
      }
      this.match('symbol', ',');
    }

    return { name, params, body, filters };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseQuery(input: string): Query {
  const tokens = tokenize(input);
  return new Parser(tokens).parseQuery();
}

export function parseRule(input: string): DatalogRule {
  const tokens = tokenize(input);
  return new Parser(tokens).parseRule();
}

/**
 * Shorthand: parse a simple "find entities where" query.
 *
 * Example: `find ?e where type = "Project"`
 * Becomes: SELECT ?e WHERE { [?e "type" "Project"] }
 */
export function parseSimple(input: string): Query {
  const trimmed = input.trim();

  // Try to detect if it's already a full query (starts with SELECT/WHERE)
  const upper = trimmed.toUpperCase();
  if (upper.startsWith('SELECT') || upper.startsWith('WHERE')) {
    return parseQuery(trimmed);
  }

  // Simple format: find ?vars where attr op value [and attr op value]*
  const findMatch = trimmed.match(/^find\s+(.+?)\s+where\s+(.+)$/i);
  if (findMatch) {
    const vars = findMatch[1].trim().split(/\s+/);
    const conditions = findMatch[2].trim();

    const selectVars = vars.map((v) => v.startsWith('?') ? v : `?${v}`);
    const entity = selectVars[0];

    // Parse conditions: "attr op value [and attr op value]*"
    const parts = conditions.split(/\s+and\s+/i);
    const patterns: string[] = [];
    const filters: string[] = [];

    for (const part of parts) {
      const eqMatch = part.match(/^(\S+)\s*(=|!=|<|<=|>|>=|contains|startsWith|endsWith|matches)\s*(.+)$/);
      if (eqMatch) {
        const [, attr, op, val] = eqMatch;
        const valTrimmed = val.trim();
        if (op === '=') {
          // Direct fact pattern
          patterns.push(`[${entity} "${attr}" ${valTrimmed}]`);
        } else {
          // Need a variable + filter
          const tmpVar = `?_${attr.replace(/[^a-zA-Z0-9]/g, '_')}`;
          patterns.push(`[${entity} "${attr}" ${tmpVar}]`);
          filters.push(`FILTER ${tmpVar} ${op} ${valTrimmed}`);
        }
      }
    }

    const fullQuery = `SELECT ${selectVars.join(' ')}\nWHERE {\n  ${patterns.join('\n  ')}\n}\n${filters.join('\n')}`;
    return parseQuery(fullQuery);
  }

  throw new Error(`Cannot parse query: "${trimmed}". Use full EQL-S syntax or "find ?e where attr = value".`);
}

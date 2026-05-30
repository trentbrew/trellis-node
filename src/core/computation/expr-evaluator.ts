/**
 * Expression Evaluator
 *
 * Evaluates @expr fields with built-in functions.
 * Supports: $if, $round, $concat, $len, $lower, $upper, $trim, $now, $uuid
 */

import type { Atom } from '../store/eav-store.js';

export interface EvalContext {
  [key: string]: unknown;
}

export class ExprEvaluator {
  private functions: Map<string, (...args: unknown[]) => unknown>;

  constructor() {
    this.functions = new Map([
      ['$if', this.if.bind(this)],
      ['$round', this.round.bind(this)],
      ['$concat', this.concat.bind(this)],
      ['$len', this.len.bind(this)],
      ['$lower', this.lower.bind(this)],
      ['$upper', this.upper.bind(this)],
      ['$trim', this.trim.bind(this)],
      ['$now', this.now.bind(this)],
      ['$uuid', this.uuid.bind(this)],
      ['$add', this.add.bind(this)],
      ['$sub', this.sub.bind(this)],
      ['$mul', this.mul.bind(this)],
      ['$div', this.div.bind(this)],
      ['$mod', this.mod.bind(this)],
      ['$eq', this.eq.bind(this)],
      ['$ne', this.ne.bind(this)],
      ['$gt', this.gt.bind(this)],
      ['$gte', this.gte.bind(this)],
      ['$lt', this.lt.bind(this)],
      ['$lte', this.lte.bind(this)],
      ['$and', this.and.bind(this)],
      ['$or', this.or.bind(this)],
      ['$not', this.not.bind(this)],
      ['$coalesce', this.coalesce.bind(this)],
      ['$contains', this.contains.bind(this)],
      ['$startsWith', this.startsWith.bind(this)],
      ['$endsWith', this.endsWith.bind(this)],
    ]);
  }

  /**
   * Evaluate an expression string against a context.
   */
  eval(expr: string, context: EvalContext): unknown {
    const trimmed = expr.trim();

    // Function call
    const fnMatch = trimmed.match(/^(\$\w+)\((.*)\)$/s);
    if (fnMatch) {
      const fnName = fnMatch[1];
      const argsStr = fnMatch[2];
      const fn = this.functions.get(fnName);
      if (!fn) {
        throw new Error(`Unknown function: ${fnName}`);
      }
      return this.evalFunction(fn, argsStr, context);
    }

    // Field reference ($field)
    if (trimmed.startsWith('$')) {
      const field = trimmed.slice(1);
      return context[field];
    }

    // Boolean literals
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;

    // Null
    if (trimmed === 'null') return null;

    // Number
    const num = Number(trimmed);
    if (!isNaN(num) && trimmed !== '') return num;

    // String (remove quotes)
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }

    // Fallback — return as-is
    return trimmed;
  }

  private evalFunction(
    fn: (...args: unknown[]) => unknown,
    argsStr: string,
    context: EvalContext,
  ): unknown {
    const args = this.parseArgs(argsStr, context);
    return fn(...args);
  }

  private parseArgs(argsStr: string, context: EvalContext): unknown[] {
    const args: unknown[] = [];
    let depth = 0;
    let current = '';

    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];
      if (char === '(' || char === '[' || char === '{') depth++;
      else if (char === ')' || char === ']' || char === '}') depth--;
      else if (char === ',' && depth === 0) {
        args.push(this.eval(current.trim(), context));
        current = '';
        continue;
      }
      current += char;
    }

    if (current.trim()) {
      args.push(this.eval(current.trim(), context));
    }

    return args;
  }

  // Built-in functions
  private if(cond: unknown, trueVal: unknown, falseVal: unknown): unknown {
    return cond ? trueVal : falseVal;
  }

  private round(value: unknown, decimals = 0): number {
    const n = Number(value);
    const factor = Math.pow(10, Number(decimals));
    return Math.round(n * factor) / factor;
  }

  private concat(...args: unknown[]): string {
    return args.map((a) => String(a ?? '')).join('');
  }

  private len(value: unknown): number {
    if (typeof value === 'string') return value.length;
    if (Array.isArray(value)) return value.length;
    return 0;
  }

  private lower(value: unknown): string {
    return String(value ?? '').toLowerCase();
  }

  private upper(value: unknown): string {
    return String(value ?? '').toUpperCase();
  }

  private trim(value: unknown): string {
    return String(value ?? '').trim();
  }

  private now(): string {
    return new Date().toISOString();
  }

  private uuid(): string {
    return crypto.randomUUID();
  }

  private add(...args: unknown[]): number {
    return args.reduce((sum: number, a) => sum + Number(a), 0);
  }

  private sub(a: unknown, b: unknown): number {
    return Number(a) - Number(b);
  }

  private mul(...args: unknown[]): number {
    return args.reduce((prod: number, a) => prod * Number(a), 1);
  }

  private div(a: unknown, b: unknown): number {
    return Number(a) / Number(b);
  }

  private mod(a: unknown, b: unknown): number {
    return Number(a) % Number(b);
  }

  private eq(a: unknown, b: unknown): boolean {
    return a === b;
  }

  private ne(a: unknown, b: unknown): boolean {
    return a !== b;
  }

  private gt(a: unknown, b: unknown): boolean {
    return Number(a) > Number(b);
  }

  private gte(a: unknown, b: unknown): boolean {
    return Number(a) >= Number(b);
  }

  private lt(a: unknown, b: unknown): boolean {
    return Number(a) < Number(b);
  }

  private lte(a: unknown, b: unknown): boolean {
    return Number(a) <= Number(b);
  }

  private and(...args: unknown[]): boolean {
    return args.every(Boolean);
  }

  private or(...args: unknown[]): boolean {
    return args.some(Boolean);
  }

  private not(value: unknown): boolean {
    return !value;
  }

  private coalesce(...args: unknown[]): unknown {
    for (const arg of args) {
      if (arg !== null && arg !== undefined) return arg;
    }
    return null;
  }

  private contains(haystack: unknown, needle: unknown): boolean {
    return String(haystack ?? '').includes(String(needle ?? ''));
  }

  private startsWith(str: unknown, prefix: unknown): boolean {
    return String(str ?? '').startsWith(String(prefix ?? ''));
  }

  private endsWith(str: unknown, suffix: unknown): boolean {
    return String(str ?? '').endsWith(String(suffix ?? ''));
  }
}

/**
 * Evaluate an expression and return a valid Atom.
 */
export function evalExpr(expr: string, context: EvalContext): Atom {
  const result = new ExprEvaluator().eval(expr, context);

  if (result === null || result === undefined) return '';
  if (typeof result === 'boolean') return result ? 'true' : 'false';
  if (typeof result === 'number') return result;
  if (typeof result === 'string') return result;
  if (typeof result === 'object') return JSON.stringify(result);

  return String(result);
}

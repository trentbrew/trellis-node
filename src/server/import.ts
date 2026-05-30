/**
 * Trellis Server — Data Import
 *
 * Ingest records from CSV, JSON, NDJSON, and Parquet files into the kernel.
 * Each row becomes a Trellis entity of the given type.
 *
 * @module trellis/server
 */

import { readFileSync } from 'fs';
import { extname } from 'path';
import type { TrellisKernel } from '../core/kernel/trellis-kernel.js';
import { jsonEntityFacts } from '../core/store/eav-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportOptions {
  /** Entity type to assign to every imported record. */
  type: string;
  /** Optional: field to use as entity ID. Defaults to auto-generated UUIDs. */
  idField?: string;
  /** Optional: prefix for generated entity IDs. Default: `import:` */
  idPrefix?: string;
  /** Skip rows where this field is falsy. */
  skipEmpty?: boolean;
  /** Max rows to import (useful for testing). */
  limit?: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  entityIds: string[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Import data from a file into the kernel.
 * Format is inferred from the file extension.
 */
export async function importFile(
  kernel: TrellisKernel,
  filePath: string,
  opts: ImportOptions,
): Promise<ImportResult> {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case '.json':
      return importJson(kernel, filePath, opts);
    case '.ndjson':
    case '.jsonl':
      return importNdjson(kernel, filePath, opts);
    case '.csv':
    case '.tsv':
      return importCsv(kernel, filePath, opts);
    case '.parquet':
      return importParquet(kernel, filePath, opts);
    default:
      throw new Error(
        `Unsupported file format: ${ext}. Supported: .json, .ndjson, .jsonl, .csv, .tsv, .parquet`,
      );
  }
}

/**
 * Import from an array of plain objects directly (useful for programmatic use).
 */
export async function importRecords(
  kernel: TrellisKernel,
  records: Record<string, unknown>[],
  opts: ImportOptions,
): Promise<ImportResult> {
  return _ingestRows(kernel, records, opts);
}

// ---------------------------------------------------------------------------
// JSON import
// ---------------------------------------------------------------------------

async function importJson(
  kernel: TrellisKernel,
  filePath: string,
  opts: ImportOptions,
): Promise<ImportResult> {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return _ingestRows(kernel, rows, opts);
}

// ---------------------------------------------------------------------------
// NDJSON import
// ---------------------------------------------------------------------------

async function importNdjson(
  kernel: TrellisKernel,
  filePath: string,
  opts: ImportOptions,
): Promise<ImportResult> {
  const raw = readFileSync(filePath, 'utf8');
  const rows = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return _ingestRows(kernel, rows, opts);
}

// ---------------------------------------------------------------------------
// CSV/TSV import
// ---------------------------------------------------------------------------

async function importCsv(
  kernel: TrellisKernel,
  filePath: string,
  opts: ImportOptions,
): Promise<ImportResult> {
  const raw = readFileSync(filePath, 'utf8');
  const sep = filePath.endsWith('.tsv') ? '\t' : ',';
  const rows = parseCsv(raw, sep);
  return _ingestRows(kernel, rows, opts);
}

/** Minimal CSV parser — handles quoted fields, no external dep required. */
function parseCsv(
  raw: string,
  sep = ',',
): Record<string, string>[] {
  const lines = raw.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]!, sep);
  const result: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;
    const values = splitCsvLine(line, sep);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    result.push(row);
  }

  return result;
}

function splitCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// Parquet import (stub — requires optional dep)
// ---------------------------------------------------------------------------

async function importParquet(
  kernel: TrellisKernel,
  filePath: string,
  opts: ImportOptions,
): Promise<ImportResult> {
  // Parquet support requires `parquetjs` or `@dsnp/parquetjs`.
  // We attempt a dynamic import and fail gracefully if not installed.
  let parquet: any;
  try {
    parquet = await import('parquetjs' as any);
  } catch {
    try {
      parquet = await import('@dsnp/parquetjs' as any);
    } catch {
      throw new Error(
        'Parquet support requires `parquetjs` or `@dsnp/parquetjs`.\n' +
          'Run: bun add parquetjs',
      );
    }
  }

  const reader = await parquet.ParquetReader.openFile(filePath);
  const cursor = reader.getCursor();
  const rows: Record<string, unknown>[] = [];
  let row;
  while ((row = await cursor.next()) !== null) {
    rows.push(row);
  }
  await reader.close();
  return _ingestRows(kernel, rows, opts);
}

// ---------------------------------------------------------------------------
// Core ingestion
// ---------------------------------------------------------------------------

async function _ingestRows(
  kernel: TrellisKernel,
  rows: Record<string, unknown>[],
  opts: ImportOptions,
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    skipped: 0,
    errors: [],
    entityIds: [],
  };

  const limit = opts.limit ?? Infinity;
  let count = 0;

  for (let i = 0; i < rows.length; i++) {
    if (count >= limit) break;

    const row = rows[i];
    if (!row || (opts.skipEmpty && Object.keys(row).length === 0)) {
      result.skipped++;
      continue;
    }

    try {
      const entityId = opts.idField
        ? `${opts.idPrefix ?? 'import:'}${String(row[opts.idField] ?? '')}`
        : `${opts.idPrefix ?? 'import:'}${crypto.randomUUID()}`;

      const facts = jsonEntityFacts(entityId, row, opts.type);

      await kernel.mutate('addFacts', { facts });

      result.imported++;
      result.entityIds.push(entityId);
      count++;
    } catch (err: unknown) {
      result.errors.push({
        row: i,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

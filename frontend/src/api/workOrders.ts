// ─── Work-order import: the ERP door, from the planner's side ─────────────────
//
// Two calls with the same shape on purpose. `preview` writes nothing and
// `commit` writes; both answer with one verdict per row, so the table a planner
// reads before importing is the same table they read afterwards — the rejected
// lines simply stay on screen with their reasons instead of vanishing.
//
// The server is the only thing that decides a verdict. Nothing here re-parses
// the file or guesses at a row's fate.

import { request } from './client';

/** What happened (or would happen) to one row. Mirrors vocab.IMPORT_ROW_RESULT. */
export type ImportRowResult = 'created' | 'updated' | 'rejected';

export interface ImportRowVerdict {
  /** 1-based position of the row in what was submitted, so "row 7" is findable. */
  row: number;
  result: ImportRowResult;
  /** Why it was rejected, in words a planner can act on. null when it was not. */
  reason: string | null;
  external_id: string | null;
  /** null on a preview, and on any rejected row — nothing was written. */
  work_order_id: string | null;
  /** null when the number will be assigned at import; never a guess. */
  work_order_number: string | null;
}

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  rejected: number;
}

export interface ImportOutcome {
  results: ImportRowVerdict[];
  summary: ImportSummary;
  /** true for a preview — the row count did not move. */
  dry_run: boolean;
}

/** The columns the template carries, in order. Shown under the paste box. */
export const IMPORT_COLUMNS = [
  'work_order_number', 'external_id', 'part_number', 'part_name', 'quantity',
  'due_date', 'customer_ref', 'app_name', 'department_name', 'routing_name',
  'priority', 'scheduled_start', 'scheduled_end', 'notes',
] as const;

/** Server URL of the blank template — a real file, not a blob built in the tab. */
export const IMPORT_TEMPLATE_URL = '/api/work-orders/import/template';

const LABELS: Record<ImportRowResult, string> = {
  created: 'Created',
  updated: 'Will update',
  rejected: 'Rejected',
};

/** How a verdict reads before the import has run. */
export function verdictLabel(result: ImportRowResult, applied: boolean): string {
  if (result === 'updated' && applied) return 'Updated';
  return LABELS[result];
}

/** Say what would happen. Writes nothing. */
export function previewWorkOrderImport(csv: string): Promise<ImportOutcome> {
  return request<ImportOutcome>('/work-orders/import/preview', {
    method: 'POST',
    body: JSON.stringify({ csv }),
  });
}

/** Do it. Same verdicts, applied. */
export function commitWorkOrderImport(csv: string): Promise<ImportOutcome> {
  return request<ImportOutcome>('/work-orders/import/commit', {
    method: 'POST',
    body: JSON.stringify({ csv }),
  });
}

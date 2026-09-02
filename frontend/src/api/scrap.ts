// ─── What the plant actually made ────────────────────────────────────────────
//
// Good, scrap and rework per run, and the first-pass yield that falls out of
// them. The arithmetic is backend/src/scrap.js and nowhere else — these are the
// types of what it sends back.
//
// The honesty rule these types carry: `fpy: null` means NOBODY COUNTED, and it
// travels with `fpy_reason`. It is never 0 and never 100. A screen that renders
// a null yield as "100%" is telling a plant that scraps a quarter of its work
// that it is perfect.

import { request } from './client';

/** The counts and the rate for one slice of the plant. */
export interface YieldFigures {
  good: number;
  scrap: number;
  rework: number;
  /** How many runs recorded a count. 0 ⇒ `fpy` is null, not zero. */
  sample: number;
  /** good ÷ (good + scrap), 0–1. Null when nothing was counted. */
  fpy: number | null;
  /** The same figure as whole percent. Null for the same reason. */
  fpy_pct: number | null;
  /** Why there is no yield, when there is none. Print this, not a bare dash. */
  fpy_reason: string | null;
  window_days: number | null;
  plant_date: string;
}

/** One coded reason behind a part's scrap. */
export interface ScrapReasonSlice {
  reason_code_id: string | null;
  code: string | null;
  label: string;
  scrap: number;
}

/** Scrap for one part number, with the reasons behind it. */
export interface ScrapPart extends YieldFigures {
  /** Null = these runs had no work order, so they have no part number. */
  part_number: string | null;
  part_name: string | null;
  reasons: ScrapReasonSlice[];
}

export interface ScrapByPart {
  parts: ScrapPart[];
  totals: YieldFigures;
  window_days: number | null;
  plant_date: string;
}

/**
 * Scrap grouped by part number over the last `days` PLANT days (1 = today).
 *
 * Served from the completions router, which every plan can reach — the OEE door
 * onto the same numbers (`/oee/scrap`) sits behind the Pro gate, and the shift
 * note that shows this is not a Pro screen.
 */
export function getScrapByPart(days = 30): Promise<ScrapByPart> {
  return request<ScrapByPart>(`/completions/scrap?days=${encodeURIComponent(days)}`);
}

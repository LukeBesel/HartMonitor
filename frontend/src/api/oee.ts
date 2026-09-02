// ─── Coded downtime: the Pareto and the six big losses ──────────────────────
//
// A stop used to carry a free-text "Reason (optional)", so a plant with a
// hundred spellings of "no material" had a word cloud where it needed a Pareto.
// Every stop now picks from the company's coded list (the same `reason_codes`
// the scrap and rework pickers read), and every downtime code carries one of
// the six big OEE losses.
//
// The honesty rule these types carry: minutes logged BEFORE codes existed, or
// against a code that has since been deleted, arrive as `unclassified_minutes`
// and are never redistributed across the buckets. A Pareto that spreads unknown
// minutes over known reasons invents its own top cause.

import { request } from './client';
import type { LossBucket } from './andon';

/** One bar of the Pareto: a coded reason, or the uncoded minutes. */
export interface LossReason {
  /** Null on the single "Not coded" bar. */
  reason_code_id: string | null;
  code: string | null;
  label: string;
  loss_bucket: LossBucket;
  /** How it prints, e.g. "Setup and adjustment". Null when it maps to no loss. */
  bucket_label: string | null;
  stops: number;
  minutes: number;
  /** Share of the window's stopped minutes, 0–100. Null when nothing stopped. */
  pct: number | null;
  cumulative_pct: number | null;
}

/** One of the six big losses (plus a trailing '' row when a code maps to none). */
export interface LossBucketRow {
  bucket: LossBucket;
  label: string;
  minutes: number;
  pct: number | null;
}

export interface LossesReport {
  days: number;
  plant_date: string;
  station_id: string | null;
  station_name: string | null;
  stops: number;
  total_down_minutes: number;
  classified_minutes: number;
  /** Minutes with no coded reason. Their own bar; never spread over buckets. */
  unclassified_minutes: number;
  unclassified_events: number;
  /** Non-zero buckets, largest first — the six-big-losses row. */
  buckets: LossBucketRow[];
  /** All six, always, in the vocabulary's order. */
  six_big_losses: LossBucketRow[];
  /** Descending, with a cumulative percentage. Empty when nothing stopped. */
  pareto: LossReason[];
  /** "No stops recorded today" — print this instead of a chart of zeros. */
  empty_reason: string | null;
}

/** Downtime minutes by loss and by reason over `days` plant days (1 = today). */
export function getLosses(params: { days?: number; stationId?: string } = {}): Promise<LossesReport> {
  const qs = new URLSearchParams();
  qs.set('days', String(params.days ?? 1));
  if (params.stationId) qs.set('station_id', params.stationId);
  return request<LossesReport>(`/oee/losses?${qs.toString()}`);
}

/** What a station's status change is allowed to be. */
export type StationEventType = 'running' | 'up' | 'down' | 'maintenance' | 'idle';

export interface StationEventInput {
  event_type: StationEventType;
  /** REQUIRED for 'down' and 'maintenance'; refused server-side without it. */
  reason_code_id?: string;
  /** The optional note beside the code — "third time this week". */
  reason?: string;
}

/**
 * Log a station status change. The typed replacement for api.logOEEEvent, which
 * cannot carry a reason code.
 */
export function logStationEvent(stationId: string, body: StationEventInput): Promise<unknown> {
  return request<unknown>(`/oee/${stationId}/event`, { method: 'POST', body: JSON.stringify(body) });
}

/** True when stopping a station in this state has to name a coded reason. */
export function needsReasonCode(type: StationEventType): boolean {
  return type === 'down' || type === 'maintenance';
}

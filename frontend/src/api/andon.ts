// ─── Andon: the clock, the tiers, and the coded reason list ──────────────────
//
// A help call used to be a row with an age and nothing else, so "waiting 46m"
// read the same whether the target was five minutes or an hour. Every call now
// carries `respond_by` — the instant its team's target runs out — and an
// `escalation_level` counting how many tiers it has climbed (0, 1 or 2 —
// escalation is a LEVEL, not a fourth status word, because andon_calls.status
// is frozen at three by a constraint that cannot be altered in place).
//
// The honesty rule these types exist to carry: a number nobody measured is
// null, never 0, and it travels with the reason it is missing.
// `within_target_pct: 0` means every call today was late; `null` with
// `within_target_reason` means nothing has been acknowledged. A board that
// renders those the same way is lying about the plant.

import { request } from './client';
import type { AndonCall, AndonSummary, AndonTeam } from '../types';

/** One call, with the response clock the board counts down. */
export interface AndonCallLive extends AndonCall {
  /** ISO instant the target runs out. Null on a call raised before targets. */
  respond_by?: string | null;
  /** Server-side snapshot of the countdown; negative once the target is missed.
   *  The board recomputes it from respond_by every second — this is the value
   *  at the moment of the fetch, useful when the clocks disagree. */
  respond_in_seconds?: number | null;
  /** The target this call is measured against, in seconds. */
  target_seconds?: number | null;
  /** Why there is no target, when there is none. */
  target_reason?: string | null;
  escalation_level?: number;
  escalated_at?: string | null;
  escalated_to_user_id?: string | null;
  escalated_to_team?: string | null;
  /** "Supervisor", "Maintenance" — who it was escalated to, ready to print. */
  escalated_to_label?: string | null;
  /** Open, past its target, still unanswered. */
  overdue?: boolean;
  /** Whether this call was answered inside its target. Null = not answered. */
  within_target?: boolean | null;
}

/** The board summary, plus what it now says about targets. */
export interface AndonSummaryLive extends AndonSummary {
  /** Open calls that have already missed their target. */
  overdue?: number;
  /** Open calls that have climbed at least one tier. */
  escalated_open?: number;
  /** The mean target today's answered calls were measured against. */
  target_seconds?: number | null;
  /** Share of today's answered calls that met their target, 0-100. Null when
   *  nothing has been acknowledged — print the reason, never "0%". */
  within_target_pct?: number | null;
  within_target_reason?: string | null;
  within_target_sample?: number;
}

/** One team+priority row of the response clock. */
export interface AndonTarget {
  id: string;
  team: string;
  team_label: string;
  priority: 'normal' | 'high' | 'critical';
  /** Minutes to say "on my way" before the call escalates. */
  respond_minutes: number;
  /** Minutes the next tier gets before the call climbs again. */
  escalate_minutes: number;
  escalate_to_team: string | null;
  escalate_to_label: string;
}

export interface AndonTargetUpdate {
  team: string;
  priority: 'normal' | 'high' | 'critical';
  respond_minutes?: number;
  escalate_minutes?: number;
  escalate_to_team?: AndonTeam;
}

/** What a coded reason explains. Mirrors vocab.REASON_KIND. */
export type ReasonKind = 'scrap' | 'rework' | 'downtime';

/** The six big OEE losses, plus '' for a reason that maps to none of them. */
export type LossBucket =
  | '' | 'breakdown' | 'setup_adjustment' | 'minor_stop'
  | 'speed_loss' | 'startup_reject' | 'process_reject';

/** One row of the company's single coded reason list. */
export interface ReasonCode {
  id: string;
  kind: ReasonKind;
  code: string;
  label: string;
  loss_bucket: LossBucket;
  is_active: boolean;
  sort_order: number;
}

export interface ReasonCodeInput {
  kind: ReasonKind;
  code: string;
  label: string;
  loss_bucket?: LossBucket;
  sort_order?: number;
}

/** The response targets, seeded with sensible defaults on a company's first read. */
export function getAndonTargets(): Promise<AndonTarget[]> {
  return request<AndonTarget[]>('/andon/targets');
}

/** Manager-or-above. Identified by team + priority, not by id. */
export function updateAndonTarget(body: AndonTargetUpdate): Promise<AndonTarget> {
  return request<AndonTarget>('/andon/targets', { method: 'PUT', body: JSON.stringify(body) });
}

/** The company's coded reasons, optionally one kind. Active only by default —
 *  a retired code leaves the picker but never leaves history. */
export function getReasonCodes(params?: { kind?: ReasonKind; include_inactive?: boolean }): Promise<ReasonCode[]> {
  const qs = new URLSearchParams();
  if (params?.kind) qs.set('kind', params.kind);
  if (params?.include_inactive) qs.set('include_inactive', 'true');
  const s = qs.toString();
  return request<ReasonCode[]>(`/andon/reason-codes${s ? `?${s}` : ''}`);
}

export function createReasonCode(body: ReasonCodeInput): Promise<ReasonCode> {
  return request<ReasonCode>('/andon/reason-codes', { method: 'POST', body: JSON.stringify(body) });
}

export function updateReasonCode(id: string, body: Partial<ReasonCodeInput> & { is_active?: boolean }): Promise<ReasonCode> {
  return request<ReasonCode>(`/andon/reason-codes/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

// ─── Reading the clock ───────────────────────────────────────────────────────

/**
 * Parses a stored timestamp as UTC whatever shape it arrives in.
 *
 * SQLite's own `datetime('now')` writes 'YYYY-MM-DD HH:MM:SS' with no zone
 * marker, while rows written through the API carry a full ISO string ending in
 * Z. Both are UTC, but `new Date()` reads the first as the BROWSER's local
 * time — which slides the countdown by the viewer's offset, so a call in
 * Auckland would read as thirteen hours overdue on a tablet in London.
 */
export function parseUtc(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const s = String(ts).trim().replace(' ', 'T');
  const ms = Date.parse(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** Seconds left before a call misses its target; negative once it has, null
 *  when the call has no target to miss. `now` is passed in so a whole board
 *  counts down against one instant. */
export function secondsToTarget(call: AndonCallLive, now: number): number | null {
  const due = parseUtc(call.respond_by);
  return due === null ? null : Math.round((due - now) / 1000);
}

/** Seconds since a call was escalated, for the "escalated 6m ago" badge. */
export function secondsSinceEscalation(call: AndonCallLive, now: number): number | null {
  const at = parseUtc(call.escalated_at);
  return at === null ? null : Math.max(0, Math.round((now - at) / 1000));
}

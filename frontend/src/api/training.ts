// ─── The training gate: what a plant asks of the person at the tablet ────────
//
// A skills matrix nothing consults is a liability, not a feature. These calls
// are the ones that make the matrix load-bearing at run start — and the reason
// they are safe to ship is that the whole thing is a company setting whose
// default is OFF. Until a manager picks Warn or Block, none of this changes a
// single run.
//
// Backend: backend/src/routes/training.js and backend/src/qualification.js.

import { request } from './client';

/** vocab.TRAINING_ENFORCEMENT — what the plant does at an unqualified start. */
export type TrainingEnforcement = 'off' | 'warn' | 'block';

/** vocab.QUALIFICATION_STATE, plus '' meaning "not measured". */
export type QualificationState = 'certified' | 'override' | 'none' | 'expired' | '';

export interface EnforcementSetting {
  enforcement: TrainingEnforcement;
  options: TrainingEnforcement[];
}

export interface QualificationCheck {
  state: QualificationState;
  expiry_date: string | null;
  mode: TrainingEnforcement;
  app_name: string;
  operator_name: string;
  /** The app is published, so the Skills Matrix asks for a certification. */
  required: boolean;
  user_id: string | null;
}

/** The 403 body a blocked start comes back with. */
export interface NotQualified {
  code: 'NOT_QUALIFIED';
  error: string;
  app_name: string;
  operator_name: string;
  state: QualificationState;
  expiry_date: string | null;
}

export interface QualificationOverride {
  id: string;
  company_id: string;
  completion_id: string | null;
  app_id: string;
  app_name: string | null;
  user_id: string | null;
  operator_name: string;
  operator_display_name: string | null;
  approved_by_user_id: string;
  approved_by_name: string;
  reason: string;
  created_at: string;
}

export interface BlockedStarts {
  days: number;
  enforcement: TrainingEnforcement;
  /** Non-null when nothing has ever been refused — the screen prints '—'. */
  empty_reason: string | null;
  apps: { app_id: string; app_name: string; blocked: number | null }[];
}

export const ENFORCEMENT_COPY: Record<TrainingEnforcement, { label: string; consequence: string }> = {
  off: {
    label: 'Off',
    consequence: 'Nobody is checked. Runs start exactly as they do now, and nothing is recorded about certification.',
  },
  warn: {
    label: 'Warn',
    consequence: 'Everyone can still start. Each run records whether the operator was signed off, so the matrix and run history agree.',
  },
  block: {
    label: 'Block',
    consequence: 'An operator with no sign-off, or an expired one, cannot start — until a supervisor approves it with their PIN. Every approval is kept, naming both people.',
  },
};

export function getEnforcement(): Promise<EnforcementSetting> {
  return request<EnforcementSetting>('/training/enforcement');
}

export function putEnforcement(enforcement: TrainingEnforcement): Promise<EnforcementSetting> {
  return request<EnforcementSetting>('/training/enforcement', {
    method: 'PUT',
    body: JSON.stringify({ enforcement }),
  });
}

export function checkQualification(p: {
  appId: string; userId?: string | null; operatorName?: string | null;
}): Promise<QualificationCheck> {
  const qs = new URLSearchParams({ app_id: p.appId });
  if (p.userId) qs.set('user_id', p.userId);
  else if (p.operatorName) qs.set('operator_name', p.operatorName);
  return request<QualificationCheck>(`/training/records/check?${qs.toString()}`);
}

export function getOverrides(): Promise<QualificationOverride[]> {
  return request<QualificationOverride[]>('/training/overrides');
}

export function getBlockedStarts(days = 7): Promise<BlockedStarts> {
  return request<BlockedStarts>(`/training/blocked-starts?days=${days}`);
}

/** Exchange a verified supervisor grant for a one-shot start token (10 min). */
export function mintOverrideToken(p: {
  appId: string; userId?: string | null; operatorName?: string; authorizerProof: string; reason?: string;
}): Promise<{ token: string; expires_in_seconds: number; app_name: string; approved_by: string }> {
  return request('/training/overrides', {
    method: 'POST',
    body: JSON.stringify({
      app_id: p.appId,
      user_id: p.userId || undefined,
      operator_name: p.operatorName || '',
      authorizer_proof: p.authorizerProof,
      reason: p.reason || '',
    }),
  });
}

export interface StartRunPayload {
  app_id: string;
  operator_name?: string;
  operator_user_id?: string;
  work_order_id?: string;
  product_type_id?: string;
  station_id?: string;
}

/**
 * Book a run. Identical to the plain POST /completions the player has always
 * made, except that it can carry a one-shot supervisor proof in the
 * X-Qualification-Override header — the header is the ONLY difference, so a
 * plant with the gate off sends exactly the request it sends today.
 *
 * The proof is either a token from mintOverrideToken(), or the
 * `authorization_id` a supervisor PIN just produced at
 * POST /api/operators/verify-authorizer. The player sends the second, because
 * /api/training is behind a supervisor write role and a tablet signed in as an
 * operator cannot call it — an override an operator can never obtain would not
 * be an override at all.
 */
export function startRun<T = { id: string }>(payload: StartRunPayload, overrideProof?: string | null): Promise<T> {
  return request<T>('/completions', {
    method: 'POST',
    body: JSON.stringify(payload),
    ...(overrideProof ? { headers: { 'X-Qualification-Override': overrideProof } } : {}),
  });
}

/** The 403 body when a start was refused for certification, or null. */
export function notQualified(err: unknown): NotQualified | null {
  const data = (err as { data?: Partial<NotQualified> } | null)?.data;
  if (!data || data.code !== 'NOT_QUALIFIED') return null;
  return {
    code: 'NOT_QUALIFIED',
    error: String(data.error ?? ''),
    app_name: String(data.app_name ?? ''),
    operator_name: String(data.operator_name ?? ''),
    state: (data.state ?? 'none') as QualificationState,
    expiry_date: data.expiry_date ?? null,
  };
}

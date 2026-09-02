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
    consequence: "An operator with no sign-off, or an expired one, cannot start — until a supervisor approves it with their PIN. Every approval is kept, naming both people. The check is against the identity the tablet asserts (badge, PIN, or the typed name), so it is only as strong as how your floor clocks in.",
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

/**
 * The purpose string a supervisor's PIN is asked for, binding one approval to
 * one app and one person.
 *
 * It must match backend/src/qualification.js `overridePurpose` character for
 * character: the server recomputes it from its own request body and hands it to
 * redeemGrant, which only opens a grant minted with that exact purpose. That is
 * what stops a grant raised to sign off an in-run NCR — or raised for a
 * different operator on a different app — from being spent as an override here.
 * A backend test asserts the two implementations agree.
 */
export function overridePurpose(appId: string, userId?: string | null, operatorName?: string | null): string {
  const who = userId ? `u:${userId}` : `n:${(operatorName ?? '').trim().toLowerCase()}`;
  return `qualification_override:${appId}:${who}`;
}

/**
 * Verify a supervisor's PIN *for this override specifically*.
 *
 * This is the same POST /api/operators/verify-authorizer the in-run NCR sheet
 * uses; the difference is the purpose, which names the app and the operator.
 * The generic api.verifyAuthorizer() in client.ts sends no purpose at all, so
 * its grants say 'ncr' and are useless here — deliberately.
 */
export function verifyOverrideAuthorizer(pin: string, p: {
  appId: string; userId?: string | null; operatorName?: string | null;
}): Promise<{ authorization_id: string; user_id: string; display_name: string; role: string }> {
  return request('/operators/verify-authorizer', {
    method: 'POST',
    body: JSON.stringify({ pin, purpose: overridePurpose(p.appId, p.userId, p.operatorName) }),
  });
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
 * The proof is a token from mintOverrideToken(), and only that: a raw
 * supervisor grant is refused. The grant is the ticket to the token door, never
 * the door itself, so a twelve-hour NCR sign-off can never be replayed as a
 * universal start permit.
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

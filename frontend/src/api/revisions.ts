// ─── App revisions: what an operator actually followed ───────────────────────
//
// Publishing an app cuts an immutable numbered revision — a snapshot of the
// steps, a change note saying what changed, the person who published it and,
// on an app under approval, the person who signed it off. Every run stamps the
// revision it ran against, server-side.
//
// The honesty rule these types carry: `app_revision` is NULL on a run that
// started before the app was ever published under change control. That run
// reads "Revision not recorded". It is never labelled Rev 1 by assumption —
// nobody knows what that operator saw, and pretending otherwise is the exact
// failure change control exists to prevent.

import { request } from './client';
import type { Step, StepGroup, AppVariable } from '../types';

/** One row of an app's change-control record. `published_by_name` /
 *  `approved_by_name` are null when that user has since been deleted — print
 *  the absence, never a substitute name. */
export interface AppRevisionSummary {
  id: string;
  revision: number;
  change_note: string;
  effective_at: string;
  created_at: string;
  published_by_user_id: string | null;
  approved_by_user_id: string | null;
  published_by_name: string | null;
  approved_by_name: string | null;
  /** How many runs this revision measured. */
  run_count: number;
}

export interface AppRevisionList {
  /** 0 = this app has never been published under change control. */
  current_revision: number;
  requires_approval: 0 | 1;
  revisions: AppRevisionSummary[];
}

/** The frozen snapshot — exactly the definition that was published. */
export interface AppRevisionSnapshot extends AppRevisionSummary {
  app_id: string;
  steps: Step[];
  variables: AppVariable[];
  step_groups: StepGroup[];
  schema_version: number | null;
}

/** What one publish changed, as the publisher reads it back. Null on a first
 *  revision — there is nothing to compare it against. */
export interface RevisionDiff {
  added: string[];
  removed: string[];
  renamed: { from: string; to: string }[];
  changed_widgets: number;
}

export interface PublishResult {
  revision: number;
  revision_id: string;
  change_note: string;
  current_revision: number;
  requires_approval: 0 | 1;
  has_unpublished_changes: boolean;
  diff: RevisionDiff | null;
  status: string;
}

export interface PublishInput {
  change_note: string;
  /** Required only when the app has requires_approval set — and it may never
   *  be the person publishing. */
  approved_by_user_id?: string | null;
}

/** The revision a run was measured against, as GET /completions/:id sends it. */
export interface RunRevisionStamp {
  revision: number;
  published_by_name: string | null;
  effective_at: string;
}

/** Publish an app: cut the next revision. Rejects (400) without a change note,
 *  and on an approval app without an approver who is somebody else. */
export const publishRevision = (appId: string, input: PublishInput) =>
  request<PublishResult>(`/apps/${appId}/publish`, { method: 'POST', body: JSON.stringify(input) });

/** An app's change-control record, newest revision first. */
export const getAppRevisions = (appId: string) =>
  request<AppRevisionList>(`/apps/${appId}/revisions`);

/** One frozen snapshot — the instructions an operator followed. */
export const getAppRevision = (appId: string, revision: number) =>
  request<AppRevisionSnapshot>(`/apps/${appId}/revisions/${revision}`);

/** Turn approval on or off for an app. Manager+ server-side. */
export const setRequiresApproval = (appId: string, requires_approval: boolean) =>
  request<{ requires_approval: 0 | 1 }>(`/apps/${appId}`, {
    method: 'PUT',
    body: JSON.stringify({ requires_approval }),
  });

/** "1 step added, 1 renamed" — or null when there is nothing to say. Written
 *  from counts the server computed; it never guesses at a change it cannot see. */
export function describeDiff(diff: RevisionDiff | null): string | null {
  if (!diff) return null;
  const parts: string[] = [];
  if (diff.added.length) parts.push(`${diff.added.length} step${diff.added.length === 1 ? '' : 's'} added`);
  if (diff.removed.length) parts.push(`${diff.removed.length} step${diff.removed.length === 1 ? '' : 's'} removed`);
  if (diff.renamed.length) parts.push(`${diff.renamed.length} renamed`);
  if (diff.changed_widgets) parts.push(`${diff.changed_widgets} field${diff.changed_widgets === 1 ? '' : 's'} changed`);
  return parts.length ? parts.join(', ') : null;
}

/** The same comparison the server makes when it cuts a revision, run in the
 *  browser so the publish modal can show what is about to change BEFORE
 *  anybody commits it. Steps are matched on id — the builder keeps step ids
 *  across a rename, which is what makes a rename read as a rename rather than
 *  as an add plus a remove. */
export function diffSteps(before: Step[], after: Step[]): RevisionDiff {
  const key = (s: Step, i: number) => (s.id ? `id:${s.id}` : `idx:${i}:${s.name ?? ''}`);
  const beforeMap = new Map((before ?? []).map((s, i) => [key(s, i), s]));
  const afterMap = new Map((after ?? []).map((s, i) => [key(s, i), s]));
  const added: string[] = [];
  const removed: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  let changedWidgets = 0;

  afterMap.forEach((step, k) => {
    const was = beforeMap.get(k);
    if (!was) { added.push(step.name || 'Untitled step'); return; }
    if ((was.name ?? '') !== (step.name ?? '')) {
      renamed.push({ from: was.name || 'Untitled step', to: step.name || 'Untitled step' });
    }
    const wasWidgets = new Map((was.widgets ?? []).map((w, i) => [w.id || `idx:${i}`, w]));
    const nowWidgets = new Map((step.widgets ?? []).map((w, i) => [w.id || `idx:${i}`, w]));
    nowWidgets.forEach((widget, id) => {
      const previous = wasWidgets.get(id);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(widget)) changedWidgets++;
    });
    wasWidgets.forEach((_w, id) => { if (!nowWidgets.has(id)) changedWidgets++; });
  });
  beforeMap.forEach((step, k) => { if (!afterMap.has(k)) removed.push(step.name || 'Untitled step'); });

  return { added, removed, renamed, changed_widgets: changedWidgets };
}

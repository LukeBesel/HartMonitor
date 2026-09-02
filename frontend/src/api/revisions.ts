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
import type { App, Step, StepGroup, AppVariable } from '../types';

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
  /** The approval policy in force when this revision was cut. */
  approval_required?: 0 | 1;
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
  /** Whether approval was required WHEN THIS REVISION WAS CUT — not the app's
   *  policy today. Without it, "no approver recorded" would misread a revision
   *  that never needed one. */
  approval_required: 0 | 1;
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
  /** Steps whose position changed. A pure reorder changes what an operator does
   *  and must never read as "no step changes". */
  moved: string[];
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

/** The app AS THE BUILDER EDITS IT — the draft, including changes not yet
 *  published. Plain GET /apps/:id serves the live revision's frozen snapshot
 *  instead, because that is what operators run and what a run is stamped with.
 *  Supervisor and above; anyone lower gets 403. */
export const getAppDraft = (appId: string) =>
  request<App & {
    current_revision: number;
    requires_approval: 0 | 1;
    has_unpublished_changes: boolean;
    served_revision: number | null;
    is_draft: boolean;
  }>(`/apps/${appId}?draft=1`);

/** What publishing right now would change, computed by the server from the same
 *  blobs and the same function that records the diff at publish time — so the
 *  preview and the record cannot disagree. */
export const getRevisionDiff = (appId: string) =>
  request<{
    current_revision: number;
    next_revision: number;
    diff: RevisionDiff | null;
    has_unpublished_changes: boolean;
  }>(`/apps/${appId}/revisions/diff`);

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
  if (diff.moved?.length) parts.push(`${diff.moved.length} step${diff.moved.length === 1 ? '' : 's'} moved`);
  if (diff.changed_widgets) parts.push(`${diff.changed_widgets} field${diff.changed_widgets === 1 ? '' : 's'} changed`);
  return parts.length ? parts.join(', ') : null;
}


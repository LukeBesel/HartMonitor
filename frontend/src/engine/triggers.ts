// ─── Trigger runtime engine (spec §3.2) ───────────────────────────────────────
// Pure TypeScript: `(trigger, state) => effects`. No React, no DOM, no fetch,
// no Date.now — elapsed time is passed in via appInfo. Async side effects
// (save_record, create_ncr) are returned as 'enqueue' effects for the player's
// outbox; the engine itself never performs I/O.
//
// Execution semantics (Tulip-derived, simplified):
//   1. The caller collects matching triggers in order (widget triggers in widget
//      order, then step triggers) and passes them to runTriggers.
//   2. Conditions evaluate with match: 'all' | 'any'; empty conditions = fire.
//   3. Actions run in order. block_with_error stops that trigger's remaining
//      actions AND cancels any navigation from this event.
//   4. First navigate/complete effect wins; remaining triggers are skipped.
//   5. set_variable effects apply to state immediately so later actions and
//      later triggers in the same event see updated values.

import type {
  Trigger, TriggerAction, TriggerCondition, TriggerEvent, TriggerOp, ValueRef,
} from '../types';
import { interpolate } from './interpolate';

export interface TriggerRuntimeState {
  variables: Record<string, string | number | boolean>;
  widgetValues: Record<string, unknown>;      // widgetId -> current value
  currentStepId: string;
  steps: { id: string; order: number }[];
  kit: { status: string; lines: { status: string; step_id: string }[] } | null;
  appInfo: Record<string, string | number>;   // keys of ValueRef['key']
  scannedCode?: string;                       // set for 'scan' events
}

export type TriggerEffect =
  | { kind: 'navigate'; to: 'next' | 'prev' | 'step' | 'complete'; stepId?: string }
  | { kind: 'set_variable'; name: string; value: string | number | boolean }
  | { kind: 'toast'; level: 'info' | 'warning'; text: string }
  | { kind: 'block'; text: string }
  | { kind: 'require_photo'; message: string }
  | { kind: 'enqueue'; op: 'save_record' | 'create_ncr'; payload: unknown };  // async outbox

// ─── Value resolution ─────────────────────────────────────────────────────────

/** Resolve a ValueRef against runtime state. Unresolvable refs yield undefined. */
export function resolveValueRef(ref: ValueRef | undefined, state: TriggerRuntimeState): unknown {
  if (!ref) return undefined;
  switch (ref.kind) {
    case 'static':
      return ref.value;
    case 'variable':
      return ref.name !== undefined ? state.variables[ref.name] : undefined;
    case 'widget':
      return ref.name !== undefined ? state.widgetValues[ref.name] : undefined;
    case 'app_info': {
      if (ref.key === undefined) return undefined;
      // scanned_code lives on state directly for 'scan' events; fall back to
      // appInfo so callers may pre-populate it there instead.
      if (ref.key === 'scanned_code' && state.scannedCode !== undefined) return state.scannedCode;
      return state.appInfo[ref.key];
    }
    default:
      return undefined;
  }
}

/** Coerce an unknown resolved value into a storable primitive. */
function toPrimitive(v: unknown): string | number | boolean {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}

// ─── Condition evaluation ─────────────────────────────────────────────────────

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

function looseEq(a: unknown, b: unknown): boolean {
  if (typeof a === typeof b) return a === b;
  if (a === undefined || a === null || b === undefined || b === null) return a === b;
  // Cross-type comparison ('5' vs 5, true vs 'true'): compare string forms.
  return String(a) === String(b);
}

function numericCmp(a: unknown, b: unknown, cmp: (x: number, y: number) => boolean): boolean {
  const na = typeof a === 'boolean' ? Number(a) : Number(a as string | number);
  const nb = typeof b === 'boolean' ? Number(b) : Number(b as string | number);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  return cmp(na, nb);
}

/** kit_complete: every line verified or picked; short/pending lines fail it.
 *  No kit at all fails it (a kit step without a kit can never be "complete"). */
function kitComplete(state: TriggerRuntimeState): boolean {
  if (!state.kit) return false;
  return state.kit.lines.every(l => l.status === 'verified' || l.status === 'picked');
}

/** kit_has_short: any line flagged short. */
function kitHasShort(state: TriggerRuntimeState): boolean {
  if (!state.kit) return false;
  return state.kit.lines.some(l => l.status === 'short');
}

/** Evaluate a single condition against runtime state. */
export function evaluateCondition(cond: TriggerCondition, state: TriggerRuntimeState): boolean {
  const op: TriggerOp = cond.op;
  // Kit operators need no operands (spec §3.1).
  if (op === 'kit_complete') return kitComplete(state);
  if (op === 'kit_has_short') return kitHasShort(state);

  const left = resolveValueRef(cond.left, state);
  if (op === 'is_blank') return isBlank(left);
  if (op === 'not_blank') return !isBlank(left);

  const right = resolveValueRef(cond.right, state);
  switch (op) {
    case 'eq':  return looseEq(left, right);
    case 'neq': return !looseEq(left, right);
    case 'gt':  return numericCmp(left, right, (x, y) => x > y);
    case 'gte': return numericCmp(left, right, (x, y) => x >= y);
    case 'lt':  return numericCmp(left, right, (x, y) => x < y);
    case 'lte': return numericCmp(left, right, (x, y) => x <= y);
    case 'contains':
      if (left === undefined || left === null) return false;
      return String(left).includes(right === undefined || right === null ? '' : String(right));
    default:
      return false;
  }
}

/** Evaluate a trigger's condition list with its all/any matcher.
 *  Empty conditions always pass (spec: "empty = always fire"). */
export function conditionsPass(trigger: Trigger, state: TriggerRuntimeState): boolean {
  if (trigger.conditions.length === 0) return true;
  return trigger.match === 'any'
    ? trigger.conditions.some(c => evaluateCondition(c, state))
    : trigger.conditions.every(c => evaluateCondition(c, state));
}

// ─── Action execution ─────────────────────────────────────────────────────────

function actionEffects(
  action: TriggerAction,
  state: TriggerRuntimeState,
): TriggerEffect[] {
  const vars = state.variables;
  const info = state.appInfo;
  switch (action.type) {
    case 'go_to_step':
      return [{ kind: 'navigate', to: 'step', stepId: action.stepId }];
    case 'next_step':
      return [{ kind: 'navigate', to: 'next' }];
    case 'prev_step':
      return [{ kind: 'navigate', to: 'prev' }];
    case 'complete_app':
      return [{ kind: 'navigate', to: 'complete' }];
    case 'set_variable':
      return [{ kind: 'set_variable', name: action.name, value: toPrimitive(resolveValueRef(action.value, state)) }];
    case 'show_message':
      return [{ kind: 'toast', level: action.level, text: interpolate(action.text, vars, info) }];
    case 'block_with_error':
      return [{ kind: 'block', text: interpolate(action.text, vars, info) }];
    case 'require_photo':
      return [{ kind: 'require_photo', message: interpolate(action.message ?? 'Photo required', vars, info) }];
    case 'save_record': {
      const fields: Record<string, string | number | boolean> = {};
      for (const [fieldId, ref] of Object.entries(action.fields)) {
        fields[fieldId] = toPrimitive(resolveValueRef(ref, state));
      }
      return [{ kind: 'enqueue', op: 'save_record', payload: { tableId: action.tableId, fields } }];
    }
    case 'create_ncr':
      return [{
        kind: 'enqueue', op: 'create_ncr', payload: {
          severity: action.severity,
          title: interpolate(action.title, vars, info),
          description: interpolate(action.description ?? '', vars, info),
        },
      }];
    default:
      return [];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a single trigger against state. Pure: never mutates `state`.
 * Returns [] when the trigger is disabled or its conditions do not pass.
 * block_with_error stops the trigger's remaining actions.
 * set_variable results are visible to this trigger's own later actions.
 */
export function runTrigger(trigger: Trigger, state: TriggerRuntimeState): TriggerEffect[] {
  if (trigger.enabled === false) return [];
  if (!conditionsPass(trigger, state)) return [];

  const effects: TriggerEffect[] = [];
  // Working copy so set_variable is visible to later actions without mutating input.
  let working: TriggerRuntimeState = { ...state, variables: { ...state.variables } };

  for (const action of trigger.actions) {
    const produced = actionEffects(action, working);
    for (const eff of produced) {
      effects.push(eff);
      if (eff.kind === 'set_variable') {
        working = { ...working, variables: { ...working.variables, [eff.name]: eff.value } };
      }
    }
    // Tulip: action failure skips the rest of the trigger's actions.
    if (action.type === 'block_with_error') break;
  }
  return effects;
}

/**
 * Run every enabled trigger matching `event`, in the given order, against state.
 * Pure: never mutates `state`.
 *
 * - set_variable effects apply to the working state between (and within)
 *   triggers, so later triggers see updated values.
 * - The first navigate/complete effect wins: remaining triggers are skipped.
 * - A block effect cancels navigation for the whole event: any already-queued
 *   navigate effect is removed and later ones are suppressed.
 */
export function runTriggers(
  triggers: Trigger[],
  event: TriggerEvent,
  state: TriggerRuntimeState,
): TriggerEffect[] {
  const effects: TriggerEffect[] = [];
  let variables = { ...state.variables };
  let blocked = false;
  let navigated = false;

  for (const trigger of triggers) {
    if (trigger.event !== event || trigger.enabled === false) continue;

    const produced = runTrigger(trigger, { ...state, variables });
    for (const eff of produced) {
      if (eff.kind === 'set_variable') {
        variables = { ...variables, [eff.name]: eff.value };
        effects.push(eff);
      } else if (eff.kind === 'navigate') {
        // Suppressed after a block or once a navigation already won.
        if (blocked || navigated) continue;
        navigated = true;
        effects.push(eff);
      } else if (eff.kind === 'block') {
        blocked = true;
        // Cancel any pending navigation queued earlier in this event.
        for (let i = effects.length - 1; i >= 0; i--) {
          if (effects[i].kind === 'navigate') effects.splice(i, 1);
        }
        navigated = false;
        effects.push(eff);
      } else {
        effects.push(eff);
      }
    }

    // First navigation/complete wins — remaining triggers for this event skip.
    if (navigated) break;
  }
  return effects;
}

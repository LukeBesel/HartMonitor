// ─── Engine barrel (spec §8 Task B) ───────────────────────────────────────────
// Pure TypeScript runtime for the app platform v2: trigger engine, v1→v2
// normalize shim, and {{variable}} interpolation. Zero React/DOM imports.

export { normalizeApp } from './normalize';
export { interpolate, MISSING_PLACEHOLDER } from './interpolate';
export type { InterpolationScope } from './interpolate';
export {
  runTrigger, runTriggers,
  evaluateCondition, conditionsPass, resolveValueRef,
} from './triggers';
export type { TriggerRuntimeState, TriggerEffect } from './triggers';

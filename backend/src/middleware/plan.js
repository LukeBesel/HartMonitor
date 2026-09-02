const db = require('../db');
const { config } = require('../config');

// Plan-tier gate. Pairs with requireAuth (which sets req.companyId) to enforce
// paid features at the API layer — not just in the UI — so a Free-tier account
// can't unlock Pro/Enterprise functionality by calling the API directly.
const TIER_LEVELS = { free: 0, pro: 1, enterprise: 2 };

function requirePlan(minTier) {
  return (req, res, next) => {
    // Early access: every feature is open for every account. This is the
    // fail-open path — EARLY_ACCESS defaults ON, so an unset variable opens
    // every gate; backend/src/config.js prints '[plan] EARLY_ACCESS is on' at
    // boot in production so it is never a silent condition.
    if (config.earlyAccess) return next();
    const plan = db.prepare('SELECT * FROM plan WHERE company_id = ?').get(req.companyId) ||
      { tier: 'free', status: 'active', trial_ends_at: null, grace_period_ends_at: null };

    // Active trial = Pro access
    const onActiveTrial = plan.trial_ends_at && new Date(plan.trial_ends_at) > new Date();
    if (onActiveTrial) return next();

    // Grace period after payment failure = allow through (briefly)
    const inGracePeriod = plan.grace_period_ends_at && new Date(plan.grace_period_ends_at) > new Date();
    if (inGracePeriod && plan.subscription_status === 'past_due') return next();

    // Check tier level
    const userTier = TIER_LEVELS[plan.tier] ?? 0;
    const requiredTier = TIER_LEVELS[minTier] ?? 1;
    if (userTier < requiredTier) {
      return res.status(403).json({
        error: `This feature requires a ${minTier} plan`,
        code: 'PLAN_REQUIRED',
        required_tier: minTier,
        current_tier: plan.tier,
      });
    }

    next();
  };
}

module.exports = { requirePlan, TIER_LEVELS };

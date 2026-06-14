const db = require('../db');

// Plan-tier gate. Pairs with requireAuth (which sets req.companyId) to enforce
// paid features at the API layer — not just in the UI — so a Free-tier account
// can't unlock Pro/Enterprise functionality by calling the API directly.
const TIER_LEVELS = { free: 0, pro: 1, enterprise: 2 };

function requirePlan(minTier) {
  const required = TIER_LEVELS[minTier] ?? 99;
  return (req, res, next) => {
    const plan = db.prepare('SELECT tier FROM plan WHERE company_id = ?').get(req.companyId);
    const level = TIER_LEVELS[plan?.tier] ?? 0;
    if (level < required) {
      return res.status(402).json({
        error: 'plan_required',
        code: 'PLAN_REQUIRED',
        message: `This feature requires the ${minTier.charAt(0).toUpperCase() + minTier.slice(1)} plan.`,
        required_tier: minTier,
        current_tier: plan?.tier || 'free',
      });
    }
    next();
  };
}

module.exports = { requirePlan, TIER_LEVELS };

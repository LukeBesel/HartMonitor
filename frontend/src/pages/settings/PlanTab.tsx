// ─── Plan, add-on slots, checkout and billing history ───────────────────────
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Check, ClipboardList, Package, ShoppingCart, ShieldCheck, Star, Zap, AlertCircle, Plus, Trash2, X, AppWindow, LayoutGrid, BarChart3, CalendarRange, Cpu, GitBranch } from 'lucide-react';
import { usePlan } from '../../context/PlanContext';
import { api } from '../../api/client';
import type { PlanTier, AddonPricing } from '../../types';
import { ProgressBar, Toast } from './shared';

const FREE_FEATURES = [
  'Up to 5 production apps',
  'Up to 2 dashboards',
  'Basic analytics',
  'CSV export',
  'Inventory tracking',
];

const PRO_FEATURES = [
  'Up to 50 production apps',
  'Up to 10 dashboards',
  'Product Routing & Scheduling',
  'OEE (App comparison tab) & advanced analytics',
  'Full data export (JSON bundle)',
  'Purchase orders & vendors',
  'NCR / Quality management',
  'Priority support',
];

const ENTERPRISE_FEATURES = [
  'Everything in Pro',
  'Custom integrations',
  'Dedicated onboarding',
  'SLA guarantees',
  'Multi-site support',
  'Custom reporting',
  'SSO / SAML',
];

// ─── Tab 2: Plan & Billing ────────────────────────────────────────────────────

type CheckoutItem = {
  kind: 'tier' | 'addon';
  tier?: PlanTier;
  addonType?: 'app_slot' | 'dashboard_slot';
  name: string;
  quantity: number;
  unitPrice: number;
};

function CheckoutModal({ item, onClose, onComplete }: {
  item: CheckoutItem;
  onClose: () => void;
  onComplete: (message: string) => void;
}) {
  const { refresh } = usePlan();
  const [card, setCard] = useState({ number: '4242 4242 4242 4242', expiry: '12/28', cvc: '123', name: 'Demo Customer' });
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const total = item.unitPrice * item.quantity;

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPaying(true);
    try {
      if (item.kind === 'tier' && item.tier) {
        await api.updatePlan({ tier: item.tier });
      } else if (item.kind === 'addon' && item.addonType) {
        await api.purchaseAddon(item.addonType, item.quantity);
      }
      refresh();
      onComplete(item.kind === 'tier'
        ? `Welcome to ${item.name}! Your plan has been upgraded.`
        : `${item.name} ×${item.quantity} added -- capacity unlocked instantly.`);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Payment failed');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
              <CreditCard size={16} />
            </div>
            <h3 className="font-semibold text-gray-800">Checkout</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* Order summary */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center justify-between text-sm">
            <div>
              <div className="font-medium text-gray-800">{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</div>
              <div className="text-xs text-gray-500">Billed monthly · cancel anytime</div>
            </div>
            <div className="text-right">
              <div className="font-bold text-gray-900">${total}/mo</div>
              {item.quantity > 1 && <div className="text-xs text-gray-500">${item.unitPrice}/mo each</div>}
            </div>
          </div>
        </div>

        <form onSubmit={handlePay} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Cardholder Name</label>
            <input className="input-field w-full" value={card.name}
              onChange={e => setCard(c => ({ ...c, name: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Card Number</label>
            <input className="input-field w-full font-mono" value={card.number}
              onChange={e => setCard(c => ({ ...c, number: e.target.value }))} required />
          </div>
          <div className="field-row gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Expiry</label>
              <input className="input-field w-full font-mono" value={card.expiry}
                onChange={e => setCard(c => ({ ...c, expiry: e.target.value }))} required placeholder="MM/YY" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">CVC</label>
              <input className="input-field w-full font-mono" value={card.cvc}
                onChange={e => setCard(c => ({ ...c, cvc: e.target.value }))} required />
            </div>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={paying}
            className="btn-primary w-full flex items-center justify-center gap-2 py-3">
            {paying ? (
              <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Processing…</>
            ) : (
              <>Pay ${total}/mo</>
            )}
          </button>
          <p className="text-center text-xs text-gray-400">
            Demo checkout -- no real payment is processed. Any card details work.
          </p>
        </form>
      </div>
    </div>
  );
}

function AddonCard({ addonType, addon, owned, onPurchase, onRemove }: {
  addonType: 'app_slot' | 'dashboard_slot';
  addon: AddonPricing;
  owned: number;
  onPurchase: (qty: number) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState(1);
  const Icon = addonType === 'app_slot' ? AppWindow : LayoutGrid;

  return (
    <div className="card p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
          <Icon size={18} />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-800">{addon.name}</div>
            <div className="text-sm font-bold text-gray-900">${addon.monthly_price}<span className="text-xs font-normal text-gray-500">/mo</span></div>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">{addon.description}</div>
          {owned > 0 && (
            <div className="text-xs mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
              <Check size={10} /> {owned} owned -- ${owned * addon.monthly_price}/mo
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
          <button onClick={() => setQty(q => Math.max(1, q - 1))}
            className="px-2.5 py-1.5 text-gray-500 hover:bg-gray-50 text-sm font-bold">−</button>
          <span className="px-3 py-1.5 text-sm font-semibold text-gray-800 min-w-[2.5rem] text-center">{qty}</span>
          <button onClick={() => setQty(q => Math.min(10, q + 1))}
            className="px-2.5 py-1.5 text-gray-500 hover:bg-gray-50 text-sm font-bold">+</button>
        </div>
        <button onClick={() => onPurchase(qty)} className="btn-primary flex-1 text-sm py-2 flex items-center justify-center gap-1.5">
          <Plus size={13} /> Add -- ${addon.monthly_price * qty}/mo
        </button>
        {owned > 0 && (
          <button onClick={onRemove} title="Remove one slot"
            className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors border border-gray-200">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export function PlanTab() {
  const { plan, loading, refresh, isFree, isPro, isEnterprise } = usePlan();
  const [searchParams, setSearchParams] = useSearchParams();
  const [checkout, setCheckout] = useState<CheckoutItem | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [billingMode, setBillingMode] = useState<'demo' | 'test' | 'live'>('demo');
  const [redirecting, setRedirecting] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  // Detect whether real Stripe payments are enabled on this deployment.
  useEffect(() => {
    api.getBillingConfig().then(c => setBillingMode(c.mode)).catch(() => setBillingMode('demo'));
  }, []);

  // Handle return from Stripe Checkout (?checkout=success|cancel).
  //
  // Cleared through the router, not window.history.replaceState. Settings is
  // one screen with four tabs now, and the shell reads the router's own copy of
  // the query: a raw replaceState left that copy holding ?checkout=success, so
  // the next tab click wrote it back into the address bar and "Payment
  // successful" fired all over again.
  useEffect(() => {
    const result = searchParams.get('checkout');
    if (!result) return;
    if (result === 'success') { showToast('Payment successful -- your plan is now active.'); refresh(); }
    else if (result === 'cancel') showToast('Checkout canceled -- no charge was made.', 'error');
    const next = new URLSearchParams(searchParams);
    next.delete('checkout');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const isLive = billingMode !== 'demo';

  // Route a purchase either to real Stripe Checkout or the demo modal.
  const startPurchase = async (item: CheckoutItem) => {
    if (!isLive) { setCheckout(item); return; }
    setRedirecting(true);
    try {
      const tier = item.kind === 'tier' ? (item.tier ?? 'pro') : (item.addonType ?? 'app_slot');
      const { url } = await api.createCheckout(tier);
      window.location.href = url;
    } catch (err: any) {
      showToast(err.message || 'Could not start checkout', 'error');
      setRedirecting(false);
    }
  };

  const handleManageBilling = async () => {
    setRedirecting(true);
    try {
      const { url } = await api.createBillingPortal();
      window.location.href = url;
    } catch (err: any) {
      showToast(err.message || 'Could not open billing portal', 'error');
      setRedirecting(false);
    }
  };

  const handleDowngrade = async () => {
    // With live billing, cancel through Stripe so we never keep charging a
    // customer whose DB plan says "free".
    if (isLive && (plan as any)?.stripe_subscription_id) {
      showToast('Manage or cancel your subscription in the billing portal.');
      return handleManageBilling();
    }
    if (!confirm('Downgrade to Free? You will lose unlimited capacity (existing data is kept).')) return;
    try {
      await api.updatePlan({ tier: 'free' });
      refresh();
      showToast('Plan changed to Free');
    } catch (err: any) {
      showToast(err.message || 'Failed to change plan', 'error');
    }
  };

  const handleRemoveAddon = async (type: 'app_slot' | 'dashboard_slot') => {
    if (isLive && (plan as any)?.stripe_subscription_id) {
      showToast('Adjust add-on subscriptions in the billing portal.');
      return handleManageBilling();
    }
    try {
      await api.removeAddon(type, 1);
      refresh();
      showToast('Add-on slot removed');
    } catch (err: any) {
      showToast(err.message || 'Failed to remove add-on', 'error');
    }
  };

  if (loading || !plan) {
    return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading plan…</div>;
  }

  // Early access: billing is off — no upgrade CTAs, no checkout, nothing to buy.
  if ((plan as any).early_access) {
    return (
      <div className="max-w-3xl">
        <div className="card p-8 border border-blue-200 bg-blue-50/50 rounded-xl text-center">
          <Zap size={28} className="mx-auto text-blue-600 mb-3" />
          <h3 className="text-lg font-semibold text-gray-900">Everything is free during early access</h3>
          <p className="text-sm text-gray-600 mt-2 max-w-lg mx-auto">
            Every module, unlimited apps and dashboards, no card required. When paid plans launch,
            you'll get advance notice and a founding discount — billing controls will appear here then.
          </p>
        </div>
      </div>
    );
  }

  const tiers = plan.pricing?.tiers;
  const addons = plan.pricing?.addons;
  const appMax  = plan.effective_app_limit ?? plan.app_limit;
  const dashMax = plan.effective_dashboard_limit ?? plan.dashboard_limit;

  return (
    <div className="space-y-8 max-w-3xl">
      {billingMode === 'demo' && (
        <div className="flex items-start gap-2.5 text-xs bg-blue-50 text-blue-800 rounded-xl px-3.5 py-2.5 border border-blue-100">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
          <span>
            <strong>Demo billing.</strong> Upgrades apply instantly without charge. To accept real
            payments that pay out to your bank, set a Stripe secret key (and webhook secret) on the
            server -- checkout then switches to Stripe automatically.
          </span>
        </div>
      )}

      {/* Current Plan Card */}
      <div className={`rounded-2xl p-6 text-white relative overflow-hidden ${
        isEnterprise ? 'bg-gradient-to-br from-purple-700 to-indigo-800'
        : isPro ? 'bg-gradient-to-br from-blue-600 to-indigo-700'
        : 'bg-gradient-to-br from-slate-700 to-slate-800'
      }`}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white" />
          <div className="absolute -bottom-12 -left-6 w-56 h-56 rounded-full bg-white" />
        </div>

        <div className="relative">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-white/20 inline-flex items-center gap-1">
                  {isPro && <span>✦</span>} {plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)} Plan
                </span>
                {billingMode === 'live' && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-400/30 text-emerald-50 inline-flex items-center gap-1">
                    <Check size={10} /> Live payments
                  </span>
                )}
                {billingMode === 'test' && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-400/30 text-amber-50">
                    Stripe test mode
                  </span>
                )}
              </div>
              <h2 className="text-2xl font-bold mt-1.5">
                ${plan.monthly_total ?? 0}<span className="text-base font-normal text-white/70">/month</span>
              </h2>
              {isFree && (plan.extra_app_slots > 0 || plan.extra_dashboard_slots > 0) && (
                <div className="text-xs text-white/70 mt-1">
                  Free base + {plan.extra_app_slots > 0 ? `${plan.extra_app_slots} app slot${plan.extra_app_slots > 1 ? 's' : ''}` : ''}
                  {plan.extra_app_slots > 0 && plan.extra_dashboard_slots > 0 ? ' + ' : ''}
                  {plan.extra_dashboard_slots > 0 ? `${plan.extra_dashboard_slots} dashboard slot${plan.extra_dashboard_slots > 1 ? 's' : ''}` : ''}
                </div>
              )}
            </div>
            {isEnterprise ? <Zap size={28} className="opacity-60" /> : isPro ? <Star size={28} className="opacity-60" /> : <CreditCard size={28} className="opacity-60" />}
          </div>

          {/* Usage stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/10 rounded-xl p-3">
              <div className="text-xs text-white/70 mb-1">Apps</div>
              <div className="text-lg font-bold mb-1.5">
                {plan.app_count ?? 0}
                <span className="text-sm font-normal text-white/70 ml-1">/ {appMax < 0 ? '∞' : appMax}</span>
                {appMax >= 0 && plan.extra_app_slots > 0 && (
                  <span className="text-[10px] font-normal text-white/50 ml-1.5">({plan.app_limit} base + {plan.extra_app_slots} add-on)</span>
                )}
              </div>
              <ProgressBar value={plan.app_count ?? 0} max={appMax} accent="rgba(255,255,255,0.8)" />
              {appMax >= 0 && <div className="text-xs text-white/60 mt-1">{Math.max(0, appMax - (plan.app_count ?? 0))} remaining</div>}
            </div>
            <div className="bg-white/10 rounded-xl p-3">
              <div className="text-xs text-white/70 mb-1">Dashboards</div>
              <div className="text-lg font-bold mb-1.5">
                {plan.dashboard_count ?? 0}
                <span className="text-sm font-normal text-white/70 ml-1">/ {dashMax < 0 ? '∞' : dashMax}</span>
                {dashMax >= 0 && plan.extra_dashboard_slots > 0 && (
                  <span className="text-[10px] font-normal text-white/50 ml-1.5">({plan.dashboard_limit} base + {plan.extra_dashboard_slots} add-on)</span>
                )}
              </div>
              <ProgressBar value={plan.dashboard_count ?? 0} max={dashMax} accent="rgba(255,255,255,0.8)" />
              {dashMax >= 0 && <div className="text-xs text-white/60 mt-1">{Math.max(0, dashMax - (plan.dashboard_count ?? 0))} remaining</div>}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-4">
            {isPro && !isEnterprise && (
              <button onClick={handleDowngrade}
                className="text-xs text-white/60 hover:text-white/90 underline underline-offset-2 transition-colors">
                Downgrade to Free
              </button>
            )}
            {isLive && (plan as any).stripe_subscription_id && (
              <button onClick={handleManageBilling} disabled={redirecting}
                className="text-xs font-medium text-white/90 hover:text-white inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors disabled:opacity-60">
                <CreditCard size={13} /> Manage Billing
              </button>
            )}
          </div>
        </div>
      </div>

      {/* À-la-carte add-ons -- only useful on a limited tier */}
      {isFree && addons && (
        <div>
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-800">À-la-carte Add-ons</h3>
            <p className="text-xs text-gray-500 mt-0.5">Need just one more app or dashboard? Add individual slots without upgrading.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <AddonCard
              addonType="app_slot"
              addon={addons.app_slot}
              owned={plan.extra_app_slots ?? 0}
              onPurchase={(qty) => startPurchase({ kind: 'addon', addonType: 'app_slot', name: addons.app_slot.name, quantity: qty, unitPrice: addons.app_slot.monthly_price })}
              onRemove={() => handleRemoveAddon('app_slot')}
            />
            <AddonCard
              addonType="dashboard_slot"
              addon={addons.dashboard_slot}
              owned={plan.extra_dashboard_slots ?? 0}
              onPurchase={(qty) => startPurchase({ kind: 'addon', addonType: 'dashboard_slot', name: addons.dashboard_slot.name, quantity: qty, unitPrice: addons.dashboard_slot.monthly_price })}
              onRemove={() => handleRemoveAddon('dashboard_slot')}
            />
          </div>
        </div>
      )}

      {/* Pro feature preview for Free accounts */}
      {isFree && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Star size={16} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-amber-900">Unlock Pro Features</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {([
              { icon: GitBranch,   label: 'Product Routing',      desc: 'Step-by-step manufacturing sequences with cycle times' },
              { icon: Cpu,         label: 'OEE (App comparison tab)', desc: 'Overall Equipment Effectiveness per station, on the OEE tab of App comparison' },
              { icon: Package,     label: 'Inventory',            desc: 'Manage raw materials, WIP, and finished goods' },
              { icon: ShoppingCart,label: 'Purchasing',           desc: 'Purchase orders and vendor management' },
              { icon: ShieldCheck, label: 'NCR / Quality',        desc: 'Non-conformance reporting and resolution workflow' },
              { icon: BarChart3,   label: 'Advanced Analytics',   desc: 'Deep throughput and efficiency reports' },
              { icon: AppWindow,   label: '50 App Slots',         desc: 'Scale up to 50 production apps' },
              { icon: LayoutGrid,  label: '10 Dashboard Slots',   desc: 'Build up to 10 custom dashboards' },
              { icon: CalendarRange, label: 'Scheduling & Planning', desc: 'Manager view, capacity planning, work order scheduling' },
              { icon: ClipboardList, label: 'Tables & Data',       desc: 'Custom data tables with full import/export' },
            ] as Array<{ icon: React.ElementType; label: string; desc: string }>).map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-2.5 p-2.5 bg-white rounded-xl border border-amber-100">
                <Icon size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-gray-800">{label}</div>
                  <div className="text-[11px] text-gray-500">{desc}</div>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => tiers && startPurchase({ kind: 'tier', tier: 'pro', name: 'Pro Plan', quantity: 1, unitPrice: tiers.pro?.monthly_price ?? 299 })}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white transition-colors"
          >
            Upgrade to Pro — $299/month
          </button>
        </div>
      )}

      {/* Pricing tiers */}
      {tiers && (
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Plans</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(['free', 'pro', 'enterprise'] as PlanTier[]).map(tierId => {
              const t = tiers[tierId];
              const isCurrent = plan.tier === tierId;
              const highlight = tierId === 'pro';
              return (
                <div key={tierId}
                  className={`rounded-xl border-2 p-4 relative ${highlight && !isCurrent ? 'shadow-md' : ''} ${
                    isCurrent ? 'border-emerald-300 bg-emerald-50/30'
                    : tierId === 'enterprise' ? 'border-purple-200 bg-purple-50/50'
                    : 'border-gray-200'
                  }`}
                  style={highlight && !isCurrent ? { borderColor: 'var(--accent)' } : {}}>
                  {highlight && !isCurrent && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                      <span className="text-white text-[10px] font-semibold px-2.5 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--accent)' }}>Most Popular</span>
                    </div>
                  )}
                  <div className="mb-3 mt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-gray-800">{t.name}</span>
                      {isCurrent && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Current</span>}
                    </div>
                    <div className="text-xl font-bold text-gray-900 mt-1">
                      {t.monthly_price === null ? 'Custom' : t.monthly_price === 0 ? '$0' : `$${t.monthly_price}`}
                      {typeof t.monthly_price === 'number' && t.monthly_price > 0 && <span className="text-xs font-normal text-gray-500">/mo</span>}
                    </div>
                    <div className="text-xs text-gray-500">
                      {t.monthly_price === null ? 'contact sales' : t.monthly_price === 0 ? 'forever' : 'billed monthly'}
                    </div>
                  </div>
                  <ul className="space-y-1.5 mb-4">
                    {t.features.slice(0, 6).map(f => (
                      <li key={f} className="flex items-start gap-1.5 text-xs text-gray-600">
                        <Check size={11} className="flex-shrink-0 mt-0.5" style={{ color: highlight ? 'var(--accent-ink)' : '#9ca3af' }} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <div className="px-3 py-2 rounded-lg bg-gray-100 text-center text-xs font-medium text-gray-500">Current Plan</div>
                  ) : tierId === 'enterprise' ? (
                    <a href="mailto:sales@hartmonitor.com" className="btn-secondary w-full flex items-center justify-center text-sm py-2">Contact Sales</a>
                  ) : tierId === 'free' ? (
                    <button onClick={handleDowngrade} className="btn-secondary w-full text-sm py-2">Downgrade</button>
                  ) : (
                    <button
                      onClick={() => startPurchase({ kind: 'tier', tier: 'pro', name: 'Pro Plan', quantity: 1, unitPrice: t.monthly_price ?? 0 })}
                      disabled={redirecting}
                      className="btn-primary w-full text-sm py-2 disabled:opacity-60">
                      {redirecting ? 'Redirecting…' : 'Upgrade to Pro'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Billing history */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Billing History</h3>
        {(plan.billing_history?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
            <CreditCard size={24} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">No billing activity yet</p>
            <p className="text-xs text-gray-400 mt-0.5">Purchases and plan changes will appear here.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
            {/* The table scrolls inside itself: several of these columns do not fit
                a phone, and the rounded card around it clipped them off entirely. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Date</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Description</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {plan.billing_history.map(b => (
                    <tr key={b.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                        {new Date(b.created_at + 'Z').toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">{b.description}</td>
                      <td className={`px-4 py-2.5 text-right font-medium whitespace-nowrap ${b.amount < 0 ? 'text-emerald-600' : 'text-gray-800'}`}>
                        {b.amount < 0 ? `−$${Math.abs(b.amount)}` : `$${b.amount}`}{b.recurring ? '/mo' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {checkout && (
        <CheckoutModal
          item={checkout}
          onClose={() => setCheckout(null)}
          onComplete={(msg) => showToast(msg)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

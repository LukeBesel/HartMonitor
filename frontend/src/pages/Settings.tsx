import { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Palette,
  CreditCard,
  Download,
  Check,
  Building2,
  Activity,
  ClipboardList,
  Package,
  ArrowUpDown,
  ShoppingCart,
  ShieldCheck,
  Archive,
  Star,
  Zap,
  AlertCircle,
  Users,
  Plus,
  Trash2,
  Edit2,
  X,
  Key,
  AppWindow,
  LayoutGrid,
} from 'lucide-react';
import { useTheme, THEME_PRESETS, Theme } from '../context/ThemeContext';
import { usePlan } from '../context/PlanContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import type { PlanTier, AddonPricing } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = 'company' | 'plan' | 'theme' | 'export' | 'users' | 'account';

interface CompanyForm {
  company_name: string;
  industry: string;
  logo_url: string;
  address: string;
  phone: string;
  email: string;
  timezone: string;
  date_format: string;
  currency: string;
  fiscal_year_start: string;
}

const DEFAULT_FORM: CompanyForm = {
  company_name: '',
  industry: '',
  logo_url: '',
  address: '',
  phone: '',
  email: '',
  timezone: 'America/New_York',
  date_format: 'MM/DD/YYYY',
  currency: 'USD',
  fiscal_year_start: 'January',
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'America/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Stockholm',
];

const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const PRESET_LABELS: Record<string, string> = {
  blue: 'Ocean Blue',
  indigo: 'Deep Indigo',
  purple: 'Royal Purple',
  teal: 'Teal',
  green: 'Forest Green',
  orange: 'Amber',
  rose: 'Rose',
  slate: 'Slate',
};

const FREE_FEATURES = [
  'Up to 3 production apps',
  'Up to 2 dashboards',
  'Basic analytics',
  'CSV export',
  'Inventory tracking',
];

const PRO_FEATURES = [
  'Unlimited production apps',
  'Unlimited dashboards',
  'Advanced analytics & OEE',
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

// ─── Helper components ────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2"
      style={{
        backgroundColor: checked ? 'var(--accent)' : '#e5e7eb',
        // @ts-ignore
        '--tw-ring-color': 'var(--accent)',
      }}
      aria-checked={checked}
      role="switch"
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function ProgressBar({ value, max, accent }: { value: number; max: number; accent: string }) {
  const pct = max < 0 ? 100 : Math.min(100, Math.round((value / max) * 100));
  const isUnlimited = max < 0;
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
      <div
        className="h-2 rounded-full transition-all"
        style={{ width: `${isUnlimited ? 40 : pct}%`, backgroundColor: accent }}
      />
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5 pb-3 border-b border-gray-100">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onDismiss }: {
  message: string;
  type?: 'success' | 'error';
  onDismiss: () => void;
}) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
        type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
      }`}
    >
      {type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
      {message}
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100 text-xs">✕</button>
    </div>
  );
}

// ─── Tab 1: Company ───────────────────────────────────────────────────────────

function CompanyTab() {
  const [form, setForm] = useState<CompanyForm>(DEFAULT_FORM);
  const [saved, setSaved] = useState<CompanyForm>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  useEffect(() => {
    api.getCompanySettings()
      .then((data: Record<string, string>) => {
        const merged: CompanyForm = { ...DEFAULT_FORM, ...data } as CompanyForm;
        setForm(merged);
        setSaved(merged);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateCompanySettings(form);
      setSaved({ ...form });
      showToast('Settings saved successfully');
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof CompanyForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm(f => ({ ...f, [key]: e.target.value }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Identity */}
      <div>
        <SectionHeader title="Identity" subtitle="Basic information about your organisation" />
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Company Name</label>
            <input
              className="input-field w-full"
              placeholder="Acme Manufacturing Co."
              value={form.company_name}
              onChange={set('company_name')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Industry</label>
            <input
              className="input-field w-full"
              placeholder="Electronics Manufacturing"
              value={form.industry}
              onChange={set('industry')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Logo URL</label>
            <input
              className="input-field w-full"
              placeholder="https://example.com/logo.png"
              value={form.logo_url}
              onChange={set('logo_url')}
            />
            {form.logo_url && (
              <div className="mt-2 flex items-center gap-3">
                <img
                  src={form.logo_url}
                  alt="Company logo preview"
                  className="h-10 rounded border border-gray-200 bg-gray-50 object-contain"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="text-xs text-gray-400">Logo preview</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Contact */}
      <div>
        <SectionHeader title="Contact" subtitle="Address and contact details" />
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
            <textarea
              className="input-field w-full resize-none"
              rows={3}
              placeholder="123 Main St, Springfield, IL 62701"
              value={form.address}
              onChange={set('address')}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
              <input
                className="input-field w-full"
                placeholder="+1 (555) 000-0000"
                value={form.phone}
                onChange={set('phone')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                className="input-field w-full"
                placeholder="ops@company.com"
                value={form.email}
                onChange={set('email')}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Preferences */}
      <div>
        <SectionHeader title="Preferences" subtitle="Localisation and formatting" />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Timezone</label>
            <select className="input-field w-full" value={form.timezone} onChange={set('timezone')}>
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Date Format</label>
            <select className="input-field w-full" value={form.date_format} onChange={set('date_format')}>
              {DATE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Currency</label>
            <select className="input-field w-full" value={form.currency} onChange={set('currency')}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Fiscal Year Start</label>
            <select className="input-field w-full" value={form.fiscal_year_start} onChange={set('fiscal_year_start')}>
              {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-2">
        <button
          className="btn-primary w-full flex items-center justify-center gap-2"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <>
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Check size={15} />
              Save Settings
            </>
          )}
        </button>
        {isDirty && (
          <span className="text-xs text-amber-600 whitespace-nowrap flex items-center gap-1">
            <AlertCircle size={12} /> Unsaved changes
          </span>
        )}
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}

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
        ? `Welcome to ${item.name}! Your workspace has been upgraded.`
        : `${item.name} ×${item.quantity} added — capacity unlocked instantly.`);
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
          <div className="grid grid-cols-2 gap-4">
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
            Demo checkout — no real payment is processed. Any card details work.
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
              <Check size={10} /> {owned} owned — ${owned * addon.monthly_price}/mo
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
          <Plus size={13} /> Add — ${addon.monthly_price * qty}/mo
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

function PlanTab() {
  const { plan, loading, refresh, isFree, isPro, isEnterprise } = usePlan();
  const [checkout, setCheckout] = useState<CheckoutItem | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const handleDowngrade = async () => {
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

  const tiers = plan.pricing?.tiers;
  const addons = plan.pricing?.addons;
  const appMax  = plan.effective_app_limit ?? plan.app_limit;
  const dashMax = plan.effective_dashboard_limit ?? plan.dashboard_limit;

  return (
    <div className="space-y-8 max-w-3xl">
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
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-white/20 inline-flex items-center gap-1">
                {isPro && <span>✦</span>} {plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)} Plan
              </span>
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

          {isPro && !isEnterprise && (
            <button onClick={handleDowngrade}
              className="mt-4 text-xs text-white/60 hover:text-white/90 underline underline-offset-2 transition-colors">
              Downgrade to Free
            </button>
          )}
        </div>
      </div>

      {/* À-la-carte add-ons — only useful on a limited tier */}
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
              onPurchase={(qty) => setCheckout({ kind: 'addon', addonType: 'app_slot', name: addons.app_slot.name, quantity: qty, unitPrice: addons.app_slot.monthly_price })}
              onRemove={() => handleRemoveAddon('app_slot')}
            />
            <AddonCard
              addonType="dashboard_slot"
              addon={addons.dashboard_slot}
              owned={plan.extra_dashboard_slots ?? 0}
              onPurchase={(qty) => setCheckout({ kind: 'addon', addonType: 'dashboard_slot', name: addons.dashboard_slot.name, quantity: qty, unitPrice: addons.dashboard_slot.monthly_price })}
              onRemove={() => handleRemoveAddon('dashboard_slot')}
            />
          </div>
        </div>
      )}

      {/* Pricing tiers */}
      {tiers && (
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Plans</h3>
          <div className="grid grid-cols-3 gap-3">
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
                        <Check size={11} className="flex-shrink-0 mt-0.5" style={{ color: highlight ? 'var(--accent)' : '#9ca3af' }} />
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
                      onClick={() => setCheckout({ kind: 'tier', tier: 'pro', name: 'Pro Plan', quantity: 1, unitPrice: t.monthly_price ?? 0 })}
                      className="btn-primary w-full text-sm py-2">
                      Upgrade to Pro
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
// ─── Tab 3: Visual Theme ──────────────────────────────────────────────────────

function ThemeTab() {
  const { theme, setTheme } = useTheme();

  const [compactMode, setCompactMode] = useState(() => {
    try { return localStorage.getItem('hm_compact') === 'true'; } catch { return false; }
  });
  const [taktWarnings, setTaktWarnings] = useState(() => {
    try { return localStorage.getItem('hm_takt_warn') !== 'false'; } catch { return true; }
  });

  const handleThemeSelect = (preset: Theme) => {
    setTheme(preset);
  };

  const handleCompactMode = (v: boolean) => {
    setCompactMode(v);
    try { localStorage.setItem('hm_compact', String(v)); } catch { /* ignore */ }
  };

  const handleTaktWarnings = (v: boolean) => {
    setTaktWarnings(v);
    try { localStorage.setItem('hm_takt_warn', String(v)); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Color Themes grid */}
      <div>
        <SectionHeader title="Color Themes" subtitle="Choose an accent colour for your workspace" />
        <div className="grid grid-cols-4 gap-4">
          {THEME_PRESETS.map((preset) => {
            const isSelected = theme.name === preset.name;
            return (
              <button
                key={preset.name}
                onClick={() => handleThemeSelect(preset)}
                className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all hover:shadow-sm ${
                  isSelected ? 'shadow-md' : 'border-gray-100 hover:border-gray-200'
                }`}
                style={isSelected ? { borderColor: preset.accent, backgroundColor: preset.accentLight } : {}}
              >
                {/* Swatch: 64×48 */}
                <div
                  className="rounded-xl flex items-center justify-center shadow-sm"
                  style={{ width: 64, height: 48, backgroundColor: preset.accent }}
                >
                  {isSelected && (
                    <Check size={18} className="text-white" strokeWidth={3} />
                  )}
                </div>
                <span className="text-[11px] font-medium text-gray-600 text-center leading-tight">
                  {PRESET_LABELS[preset.name] ?? preset.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Additional settings */}
      <div>
        <SectionHeader title="Display Preferences" subtitle="Interface behaviour stored locally" />
        <div className="space-y-1 divide-y divide-gray-50">
          <div className="flex items-center justify-between py-3.5 gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800">Compact Mode</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Reduce spacing and padding throughout the interface
              </div>
            </div>
            <Toggle checked={compactMode} onChange={handleCompactMode} />
          </div>
          <div className="flex items-center justify-between py-3.5 gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800">Show Takt Time Warnings</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Highlight steps that exceed takt time with visual indicators
              </div>
            </div>
            <Toggle checked={taktWarnings} onChange={handleTaktWarnings} />
          </div>
        </div>
      </div>

      {/* Live Preview Strip */}
      <div>
        <SectionHeader title="Live Preview" subtitle="How accent colour looks across UI elements" />
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-400 border-b border-gray-100">
            {PRESET_LABELS[theme.name] ?? theme.name} — {theme.accent}
          </div>
          <div className="p-4 flex flex-wrap items-center gap-3 bg-white">
            {/* Primary button */}
            <button
              className="px-4 py-2 rounded-lg text-white text-sm font-medium shadow-sm"
              style={{ backgroundColor: theme.accent }}
            >
              Primary Action
            </button>

            {/* Secondary button */}
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium border"
              style={{
                color: theme.accent,
                borderColor: theme.accent,
                backgroundColor: theme.accentLight,
              }}
            >
              Secondary
            </button>

            {/* Badge */}
            <div
              className="px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{ backgroundColor: theme.accentLight, color: theme.accentDark }}
            >
              Active
            </div>

            {/* Nav item simulation */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium"
              style={{ backgroundColor: theme.accentLight, color: theme.accent }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.accent }} />
              Nav Item
            </div>

            {/* Link */}
            <span className="text-sm font-medium" style={{ color: theme.accent }}>
              Hyperlink →
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 4: Data Export ───────────────────────────────────────────────────────

interface ExportCard {
  icon: React.ReactNode;
  title: string;
  description: string;
  type: string;
  params?: Record<string, string>;
}

const EXPORT_CARDS: ExportCard[] = [
  {
    icon: <Activity size={20} />,
    title: 'Completions',
    description: 'All production completions with cycle times',
    type: 'completions',
    params: { days: '90' },
  },
  {
    icon: <ClipboardList size={20} />,
    title: 'Work Orders',
    description: 'All work orders with status and progress',
    type: 'work-orders',
  },
  {
    icon: <Package size={20} />,
    title: 'Inventory',
    description: 'Current stock levels and item catalogue',
    type: 'inventory',
  },
  {
    icon: <ArrowUpDown size={20} />,
    title: 'Stock Movements',
    description: 'Full audit trail of stock changes',
    type: 'stock-movements',
  },
  {
    icon: <ShoppingCart size={20} />,
    title: 'Purchase Orders',
    description: 'All purchase orders with line items',
    type: 'purchase-orders',
  },
  {
    icon: <ShieldCheck size={20} />,
    title: 'NCRs / Quality',
    description: 'Non-conformance reports and resolutions',
    type: 'ncrs',
  },
];

function ExportCardItem({ card }: { card: ExportCard }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await api.downloadExport(card.type, card.params);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}
        >
          {card.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-800">{card.title}</div>
          <div className="text-xs text-gray-500 mt-0.5">{card.description}</div>
        </div>
      </div>
      <button
        onClick={handleDownload}
        className="btn-secondary w-full flex items-center justify-center gap-2 text-sm py-1.5"
      >
        {downloading ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-current/40 border-t-current rounded-full animate-spin" />
            Downloading…
          </>
        ) : (
          <>
            <Download size={14} />
            Download CSV
          </>
        )}
      </button>
    </div>
  );
}

function ExportTab() {
  const [bundleDownloading, setBundleDownloading] = useState(false);

  const handleBundle = async () => {
    setBundleDownloading(true);
    try {
      await api.downloadExport('all');
    } finally {
      setBundleDownloading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <p className="text-sm text-gray-600">
          Download all your data as CSV files or a complete JSON bundle.
        </p>
      </div>

      {/* 2×3 grid */}
      <div className="grid grid-cols-2 gap-4">
        {EXPORT_CARDS.map((card) => (
          <ExportCardItem key={card.type} card={card} />
        ))}
      </div>

      {/* JSON Bundle */}
      <div className="card p-6 border-2 border-dashed border-gray-200">
        <div className="flex items-start gap-4 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}
          >
            <Archive size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800">Export All as JSON Bundle</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Contains all data in a single JSON file for backup or migration.
              Includes apps, completions, work orders, inventory, purchases, and quality records.
            </div>
          </div>
        </div>
        <button
          onClick={handleBundle}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {bundleDownloading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Preparing bundle…
            </>
          ) : (
            <>
              <Download size={16} />
              Download Complete Data Bundle (.json)
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Tab 5: Users & Permissions ───────────────────────────────────────────────

const ROLE_OPTIONS = ['developer', 'manager', 'supervisor', 'operator', 'viewer'];
const ROLE_COLORS: Record<string, string> = {
  developer: 'bg-purple-100 text-purple-700',
  manager:   'bg-blue-100 text-blue-700',
  supervisor:'bg-cyan-100 text-cyan-700',
  operator:  'bg-green-100 text-green-700',
  viewer:    'bg-gray-100 text-gray-600',
};

function UserModal({ user, onClose, onSaved }: {
  user: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!user;
  const [form, setForm] = useState({
    email: user?.email ?? '',
    display_name: user?.display_name ?? '',
    role: user?.role ?? 'viewer',
    password: '',
    is_active: user?.is_active ?? 1,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload: any = { email: form.email, display_name: form.display_name, role: form.role };
      if (!isEdit) payload.password = form.password;
      else if (form.password) payload.password = form.password;
      if (isEdit) payload.is_active = form.is_active;
      if (isEdit) await api.updateUser(user.id, payload);
      else await api.createUser(payload);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">{isEdit ? 'Edit User' : 'New User'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Display Name</label>
            <input className="input-field w-full" value={form.display_name} onChange={set('display_name')} required placeholder="Jane Smith" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input type="email" className="input-field w-full" value={form.email} onChange={set('email')} required placeholder="jane@company.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
            <select className="input-field w-full" value={form.role} onChange={set('role')}>
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {isEdit ? 'New Password (leave blank to keep)' : 'Password'}
            </label>
            <input
              type="password"
              className="input-field w-full"
              value={form.password}
              onChange={set('password')}
              required={!isEdit}
              placeholder={isEdit ? 'Leave blank to keep current' : 'Min 6 characters'}
              minLength={form.password ? 6 : undefined}
            />
          </div>
          {isEdit && (
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-gray-700">Active</label>
              <button type="button"
                onClick={() => setForm(f => ({ ...f, is_active: f.is_active ? 0 : 1 }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.is_active ? 'bg-blue-600' : 'bg-gray-200'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          )}
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UsersTab() {
  const { user: currentUser, isAtLeast } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalUser, setModalUser] = useState<any | null | false>(false); // false=closed, null=new, obj=edit
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoading(true);
    api.getUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await api.deleteUser(id);
      showToast(`User "${name}" deleted`);
      load();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete user', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const canManage = isAtLeast('developer');

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">Manage who has access and what they can do.</p>
        </div>
        {canManage && (
          <button onClick={() => setModalUser(null)} className="btn-primary flex items-center gap-2">
            <Plus size={15} /> Add User
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading users…</div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Last Login</th>
                {canManage && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.id} className={`${!u.is_active ? 'opacity-50' : ''} hover:bg-gray-50/50`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))' }}>
                        {u.display_name?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-gray-800">{u.display_name}</div>
                        {u.id === currentUser?.id && <div className="text-[10px] text-blue-500">You</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${u.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setModalUser(u)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                          <Edit2 size={13} />
                        </button>
                        {u.id !== currentUser?.id && (
                          <button
                            onClick={() => handleDelete(u.id, u.display_name)}
                            disabled={deletingId === u.id}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Role permissions matrix */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Role Permissions</h3>
        <div className="rounded-xl border border-gray-200 overflow-hidden bg-white text-xs">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2.5 text-left font-semibold text-gray-500">Permission</th>
                {ROLE_OPTIONS.map(r => (
                  <th key={r} className="px-3 py-2.5 text-center font-semibold text-gray-500 capitalize">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                { label: 'View dashboards & apps', levels: [1,1,1,1,1] },
                { label: 'Run production apps', levels: [1,1,1,1,0] },
                { label: 'Manager view & analytics', levels: [1,1,1,0,0] },
                { label: 'OEE & step metrics', levels: [1,1,1,0,0] },
                { label: 'Inventory & quality', levels: [1,1,1,0,0] },
                { label: 'Purchasing & vendors', levels: [1,1,1,0,0] },
                { label: 'Create / edit apps', levels: [1,1,0,0,0] },
                { label: 'Company settings', levels: [1,1,0,0,0] },
                { label: 'Manage users', levels: [1,0,0,0,0] },
                { label: 'Delete & admin actions', levels: [1,0,0,0,0] },
              ].map(row => (
                <tr key={row.label} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 text-gray-700">{row.label}</td>
                  {row.levels.map((allowed, i) => (
                    <td key={i} className="px-3 py-2.5 text-center">
                      {allowed
                        ? <span className="text-emerald-500 font-bold">✓</span>
                        : <span className="text-gray-200">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalUser !== false && (
        <UserModal user={modalUser} onClose={() => setModalUser(false)} onSaved={load} />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// ─── Tab 6: Account / Change Password ─────────────────────────────────────────

function AccountTab() {
  const { user } = useAuth();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState('');

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.new_password !== form.confirm) { setError('New passwords do not match'); return; }
    if (form.new_password.length < 6) { setError('New password must be at least 6 characters'); return; }
    setSaving(true);
    try {
      await api.changePassword(form.current_password, form.new_password);
      setForm({ current_password: '', new_password: '', confirm: '' });
      showToast('Password changed successfully');
    } catch (err: any) {
      setError(err.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg space-y-6">
      <div className="card p-6">
        <SectionHeader title="Profile" subtitle="Your account information" />
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))' }}>
            {user?.display_name?.[0]?.toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-gray-800">{user?.display_name}</div>
            <div className="text-sm text-gray-500">{user?.email}</div>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full mt-1 inline-block ${ROLE_COLORS[user?.role ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
              {user?.role}
            </span>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <SectionHeader title="Change Password" subtitle="Update your login password" />
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Current Password</label>
            <input
              type="password"
              className="input-field w-full"
              value={form.current_password}
              onChange={e => setForm(f => ({ ...f, current_password: e.target.value }))}
              required
              placeholder="Enter current password"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              className="input-field w-full"
              value={form.new_password}
              onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))}
              required
              placeholder="Min 6 characters"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              className="input-field w-full"
              value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              required
              placeholder="Repeat new password"
            />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Saving…</> : <><Key size={14} />Change Password</>}
          </button>
        </form>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'company', label: 'Company', icon: <Building2 size={15} /> },
  { id: 'plan', label: 'Plan & Billing', icon: <CreditCard size={15} /> },
  { id: 'theme', label: 'Visual Theme', icon: <Palette size={15} /> },
  { id: 'export', label: 'Data Export', icon: <Download size={15} /> },
];

export default function SettingsPage() {
  const { isAtLeast } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('account');

  const ALL_TABS: { id: TabId; label: string; icon: React.ReactNode; minRole?: string }[] = [
    { id: 'account',  label: 'My Account',    icon: <Key size={15} /> },
    { id: 'company',  label: 'Company',        icon: <Building2 size={15} />,  minRole: 'manager' },
    { id: 'plan',     label: 'Plan & Billing', icon: <CreditCard size={15} />, minRole: 'manager' },
    { id: 'theme',    label: 'Visual Theme',   icon: <Palette size={15} /> },
    { id: 'export',   label: 'Data Export',    icon: <Download size={15} /> },
    { id: 'users',    label: 'Users & Access', icon: <Users size={15} />,      minRole: 'manager' },
  ];
  const TABS = ALL_TABS.filter(t => !t.minRole || isAtLeast(t.minRole as any));

  return (
    <div className="p-6 bg-[#f8fafc] min-h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
          style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}
        >
          <Settings size={18} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Settings</h1>
          <p className="text-xs text-gray-500 mt-0.5">Manage your account, organisation, and appearance</p>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-6 bg-white border border-gray-200 rounded-xl p-1 w-fit shadow-sm flex-wrap">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              style={active ? { backgroundColor: 'var(--accent)' } : {}}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'account'  && <AccountTab />}
        {activeTab === 'company'  && <CompanyTab />}
        {activeTab === 'plan'     && <PlanTab />}
        {activeTab === 'theme'    && <ThemeTab />}
        {activeTab === 'export'   && <ExportTab />}
        {activeTab === 'users'    && <UsersTab />}
      </div>
    </div>
  );
}

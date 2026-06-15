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
  PanelLeft,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Moon,
  Sun,
  MapPin,
  Network,
  Bell,
  Sliders,
  Webhook as WebhookIcon,
  Copy,
  Send,
  Mail,
  MessageSquare,
  Globe,
  CheckCircle2,
  XCircle,
  Crown,
  ExternalLink,
  Code,
  HelpCircle,
  Tablet,
  PlayCircle,
  BarChart3,
  CalendarRange,
  Cpu,
  GitBranch,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme, THEME_PRESETS, Theme, buildCustomTheme, applySecondary } from '../context/ThemeContext';
import { usePlan } from '../context/PlanContext';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { useNavPrefs } from '../context/NavPrefsContext';
import { SECTIONS, ALL_SECTION_ITEMS } from '../config/navigation';
import { REPLAY_FLAG } from '../components/shared/OnboardingWizard';
import { api } from '../api/client';
import Toggle from '../components/shared/Toggle';
import type { PlanTier, AddonPricing, Site, NotificationPrefs, NotificationLogEntry, RolePermissionMap, AppRole, ApiKey, Webhook, WebhookDelivery } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = 'company' | 'plan' | 'theme' | 'sidebar' | 'export' | 'users' | 'account'
  | 'sites' | 'notifications' | 'developer' | 'help';

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
  midnight: 'Midnight (Pink Glow)',
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
  'OEE Tracker & advanced analytics',
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
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { refresh: refreshBranding } = useBranding();
  const { user } = useAuth();
  const isDeveloper = user?.role === 'developer';

  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  // Detect if branding fields changed (require confirmation for developers)
  const brandingChanged = form.company_name !== saved.company_name || form.logo_url !== saved.logo_url;

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

  const doSave = async () => {
    setSaving(true);
    try {
      await api.updateCompanySettings(form);
      setSaved({ ...form });
      refreshBranding();
      showToast('Settings saved successfully');
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
      setConfirmPending(false);
    }
  };

  const handleSave = () => {
    if (isDeveloper && brandingChanged) {
      setConfirmPending(true);
    } else {
      doSave();
    }
  };

  const set = (key: keyof CompanyForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm(f => ({ ...f, [key]: e.target.value }));

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const result = ev.target?.result as string;
        // result is "data:image/png;base64,..."
        const [meta, data] = result.split(',');
        const mimeType = meta.match(/data:([^;]+)/)?.[1] ?? file.type;
        const { url } = await api.uploadImage(data, mimeType, file.name);
        setForm(f => ({ ...f, logo_url: url }));
        setUploading(false);
        showToast('Image uploaded successfully');
      };
      reader.readAsDataURL(file);
    } catch {
      showToast('Failed to upload image', 'error');
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Developer confirmation modal for branding changes */}
      {confirmPending && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertCircle size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Change company branding?</h3>
                <p className="text-xs text-gray-500">This affects all users in your organization.</p>
              </div>
            </div>
            <p className="text-sm text-gray-700 mb-5">
              You're about to update{' '}
              {[
                form.company_name !== saved.company_name && 'company name',
                form.logo_url !== saved.logo_url && 'logo',
              ].filter(Boolean).join(' and ')}
              . This change will be visible to everyone immediately.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmPending(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doSave}
                className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors"
              >
                Yes, update branding
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Identity */}
      <div>
        <SectionHeader title="Identity" subtitle="Basic information about your organization" />
        {!isDeveloper && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500">
            <Key size={13} className="text-gray-400 flex-shrink-0" />
            Company name and logo are managed by your developer. Contact them to update branding.
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Company Name
              {!isDeveloper && <span className="ml-1.5 text-[10px] text-gray-400 font-normal">(developer only)</span>}
            </label>
            <input
              className={`input-field w-full ${!isDeveloper ? 'opacity-60 cursor-not-allowed bg-gray-50' : ''}`}
              placeholder="Acme Manufacturing Co."
              value={form.company_name}
              onChange={set('company_name')}
              readOnly={!isDeveloper}
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
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Logo URL
              {!isDeveloper && <span className="ml-1.5 text-[10px] text-gray-400 font-normal">(developer only)</span>}
            </label>
            <input
              className={`input-field w-full ${!isDeveloper ? 'opacity-60 cursor-not-allowed bg-gray-50' : ''}`}
              placeholder="https://example.com/logo.png (direct image URL)"
              value={form.logo_url}
              onChange={set('logo_url')}
              readOnly={!isDeveloper}
            />
            <p className="text-xs text-gray-400 mt-1">
              Must be a direct image URL (ending in .png, .jpg, .svg, etc.). Shown in the top-left of the sidebar in place of the default mark.
            </p>
            {/* Upload from computer — developer only */}
            {isDeveloper && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  {uploading ? (
                    <><span className="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" /> Uploading…</>
                  ) : (
                    <>Upload from computer</>
                  )}
                </button>
                <span className="text-xs text-gray-400">or paste a URL above</span>
              </div>
            )}
            {form.logo_url && (
              <div className="mt-2 flex items-center gap-3">
                <img
                  src={form.logo_url}
                  alt="Logo preview"
                  className="w-12 h-12 rounded-xl object-contain bg-gray-100 border border-gray-200"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="text-xs text-gray-500">Logo preview</span>
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
        <SectionHeader title="Preferences" subtitle="Localization and formatting" />
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

function PlanTab() {
  const { plan, loading, refresh, isFree, isPro, isEnterprise } = usePlan();
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
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('checkout');
    if (!result) return;
    if (result === 'success') { showToast('Payment successful -- your plan is now active.'); refresh(); }
    else if (result === 'cancel') showToast('Checkout canceled -- no charge was made.', 'error');
    params.delete('checkout');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLive = billingMode !== 'demo';

  // Route a purchase either to real Stripe Checkout or the demo modal.
  const startPurchase = async (item: CheckoutItem) => {
    if (!isLive) { setCheckout(item); return; }
    setRedirecting(true);
    try {
      const { url } = await api.createCheckout(
        item.kind === 'tier'
          ? { tier: item.tier }
          : { addon: item.addonType, quantity: item.quantity }
      );
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
              { icon: Cpu,         label: 'OEE Tracker',          desc: 'Overall Equipment Effectiveness tracking and reporting' },
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
  const { theme, setTheme, darkMode, setDarkMode } = useTheme();
  const { user } = useAuth();
  const isDeveloper = user?.role === 'developer';
  const [confirmTheme, setConfirmTheme] = useState<Theme | null>(null);

  const handleThemeSelect = (preset: Theme) => {
    if (isDeveloper) {
      setConfirmTheme(preset);
    }
    // non-developers cannot change theme
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Theme change confirmation (developer only) */}
      {confirmTheme && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                <AlertCircle size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Change organization theme?</h3>
                <p className="text-xs text-gray-500">This affects all users immediately.</p>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setConfirmTheme(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={() => { setTheme(confirmTheme); setConfirmTheme(null); }} className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors">Apply theme</button>
            </div>
          </div>
        </div>
      )}

      {!isDeveloper && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500 mb-4">
          <Key size={13} className="text-gray-400 flex-shrink-0" />
          Theme changes are restricted to developers. Contact your developer to update the color scheme.
        </div>
      )}

      {/* Color Themes grid */}
      <div>
        <SectionHeader title="Color Themes" subtitle={isDeveloper ? "Choose an accent color for your workspace" : "Theme is set by your developer"} />
        <div className={`grid grid-cols-4 gap-4 ${!isDeveloper ? 'opacity-50 pointer-events-none' : ''}`}>
          {THEME_PRESETS.map((preset) => {
            const isSelected = theme.name === preset.name;
            return (
              <button
                key={preset.name}
                onClick={() => handleThemeSelect(preset)}
                disabled={!isDeveloper}
                className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${isDeveloper ? 'hover:shadow-sm' : 'cursor-not-allowed'} ${
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

        {/* Custom accent + secondary colors — developer only */}
        {isDeveloper && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Primary / accent */}
          <label
            className={`relative flex items-center gap-2 px-3 py-2 rounded-xl border-2 cursor-pointer transition-all hover:shadow-sm ${
              theme.name === 'custom' ? 'shadow-md' : 'border-gray-100 hover:border-gray-200'
            }`}
            style={theme.name === 'custom' ? { borderColor: theme.accent, backgroundColor: theme.accentLight } : {}}
          >
            <div
              className="w-8 h-8 rounded-lg border border-gray-200 flex-shrink-0"
              style={{ backgroundColor: theme.accent }}
            />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-gray-700">Primary color</div>
              <div className="text-[10px] text-gray-400 truncate">{theme.accent}</div>
            </div>
            <input
              type="color"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              value={theme.accent}
              onChange={(e) => setTheme(buildCustomTheme(e.target.value, theme.secondary))}
            />
          </label>

          {/* Secondary */}
          <label
            className="relative flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-gray-100 hover:border-gray-200 cursor-pointer transition-all hover:shadow-sm"
          >
            <div
              className="w-8 h-8 rounded-lg border border-gray-200 flex-shrink-0"
              style={{ background: `linear-gradient(135deg, ${theme.accent}, ${theme.secondary})` }}
            />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-gray-700">Secondary color</div>
              <div className="text-[10px] text-gray-400 truncate">{theme.secondary}</div>
            </div>
            <input
              type="color"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              value={theme.secondary}
              onChange={(e) => setTheme(applySecondary(theme, e.target.value))}
            />
          </label>
        </div>
        )}
        <p className="text-xs text-gray-400 mt-2">
          The secondary color shapes branded gradients -- logos, avatars, leaderboard cards, and upgrade banners.
        </p>
      </div>

      {/* Additional settings */}
      <div>
        <SectionHeader title="Display Preferences" subtitle="Interface behavior stored locally" />
        <div className="space-y-1 divide-y divide-gray-50">
          <div className="flex items-center justify-between py-3.5 gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                {darkMode ? <Moon size={14} /> : <Sun size={14} />}
                Dark Mode
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                Switch the interface to a dark color scheme
              </div>
            </div>
            <Toggle checked={darkMode} onChange={setDarkMode} />
          </div>
        </div>
      </div>

      {/* Live Preview Strip */}
      <div>
        <SectionHeader title="Live Preview" subtitle="How your colors look across UI elements" />
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-400 border-b border-gray-100 flex items-center gap-2">
            <span>{PRESET_LABELS[theme.name] ?? theme.name}</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: theme.accent }} />{theme.accent}</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: theme.secondary }} />{theme.secondary}</span>
          </div>
          <div className="p-4 flex flex-wrap items-center gap-3 bg-white">
            {/* Branded gradient (uses both colors) */}
            <div
              className="w-10 h-10 rounded-xl shadow-sm flex-shrink-0"
              style={{ background: `linear-gradient(135deg, ${theme.accent}, ${theme.secondary})` }}
              title="Branded gradient (primary → secondary)"
            />

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

// ─── Tab: Navigation / Workspaces ─────────────────────────────────────────────

function SidebarTab() {
  const {
    isItemHidden, toggleItem,
    isSectionHidden, toggleSection,
    focus, setFocus, resetNavPrefs,
    itemOrder, moveItem,
    showProSidebar, setShowProSidebar,
  } = useNavPrefs();
  const { user } = useAuth();
  const isDeveloper = user?.role === 'developer';
  const [showAdvanced, setShowAdvanced] = useState(false);

  const enabledSections = SECTIONS.filter(s => !isSectionHidden(s.id));
  // Keep the default-view selector honest if the focused section is now hidden.
  const focusValid = enabledSections.some(s => s.id === focus);

  // Apply the saved custom order to a section's items (matches the sidebar).
  const orderedItems = (section: typeof SECTIONS[number]) => {
    const order = itemOrder[section.id];
    if (!order || order.length === 0) return section.items;
    return [...section.items].sort((a, b) => {
      const ia = order.indexOf(a.to); const ib = order.indexOf(b.to);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Workspaces */}
      <div>
        <SectionHeader
          title="Workspaces"
          subtitle="Pick the areas you actually use. Turn one off and it disappears from the sidebar entirely -- keeping things simple."
        />
        <div className="grid sm:grid-cols-3 gap-3">
          {SECTIONS.map(section => {
            const on = !isSectionHidden(section.id);
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => toggleSection(section.id)}
                className={`text-left rounded-xl border-2 p-3.5 transition-all ${
                  on ? 'shadow-sm' : 'border-gray-100 opacity-70 hover:opacity-100'
                }`}
                style={on ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-light)' } : {}}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: on ? 'var(--accent)' : '#f1f5f9', color: on ? '#fff' : '#94a3b8' }}>
                    <Icon size={15} />
                  </div>
                  {on
                    ? <span style={{ color: 'var(--accent)' }}><Check size={16} /></span>
                    : <span className="text-[10px] font-semibold text-gray-400 uppercase">Off</span>}
                </div>
                <div className="text-sm font-semibold text-gray-800">{section.label}</div>
                <div className="text-xs text-gray-500 mt-0.5 leading-snug">{section.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Default view */}
      <div>
        <SectionHeader title="Default view" subtitle="Which workspace the sidebar opens to. You can switch anytime from the buttons at the top of the sidebar." />
        <select
          className="input-field text-sm max-w-xs"
          value={focusValid ? focus : (enabledSections[0]?.id ?? 'production')}
          onChange={e => setFocus(e.target.value as any)}
        >
          {enabledSections.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Pro sidebar developer toggle */}
      <div>
        <SectionHeader title="Developer Preview" subtitle="For developers and demos only — shows Pro-locked items in the sidebar as grayed buttons." />
        <div className="flex items-center justify-between max-w-sm p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <div>
            <div className="text-sm font-medium text-gray-800">Show Pro feature previews in sidebar</div>
            <div className="text-xs text-gray-500 mt-0.5">Adds locked Pro items back to the sidebar (developer use only)</div>
          </div>
          <Toggle checked={showProSidebar} onChange={setShowProSidebar} />
        </div>
      </div>

      {/* Advanced: per-item visibility + (developers) reordering */}
      <div>
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          {showAdvanced ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          Advanced -- show, hide{isDeveloper ? ', and reorder' : ''} individual items
        </button>
        {showAdvanced && (
          <div className="space-y-5 mt-3 pl-1">
            {isDeveloper && (
              <p className="text-xs text-gray-500">Use the arrows to reorder items within a section — the order is shared across your sidebar.</p>
            )}
            {SECTIONS.map(section => {
              const ordered = orderedItems(section);
              const orderPaths = ordered.map(i => i.to);
              return (
              <div key={section.id}>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">
                  <section.icon size={11} /> {section.label}
                </div>
                <div className="divide-y divide-gray-50">
                  {ordered.map((item, idx) => {
                    const Icon = item.icon;
                    const sectionOff = isSectionHidden(section.id);
                    return (
                      <div key={item.to} className="flex items-center justify-between py-2.5 gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isDeveloper && (
                            <div className="flex flex-col -my-1">
                              <button
                                onClick={() => moveItem(section.id, item.to, 'up', orderPaths)}
                                disabled={idx === 0}
                                className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300"
                                title="Move up"
                              >
                                <ChevronUp size={13} />
                              </button>
                              <button
                                onClick={() => moveItem(section.id, item.to, 'down', orderPaths)}
                                disabled={idx === ordered.length - 1}
                                className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300"
                                title="Move down"
                              >
                                <ChevronDown size={13} />
                              </button>
                            </div>
                          )}
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
                            <Icon size={14} />
                          </div>
                          <span className="text-sm font-medium text-gray-800 truncate">{item.label}</span>
                        </div>
                        <Toggle
                          checked={!sectionOff && !isItemHidden(item.to)}
                          onChange={() => toggleItem(item.to)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-100">
        <p className="text-xs text-gray-500">
          Command Center always stays visible. Everything here is saved on this device.
        </p>
        <button onClick={resetNavPrefs} className="btn-secondary text-sm whitespace-nowrap flex items-center gap-1.5">
          <RotateCcw size={13} /> Reset to Defaults
        </button>
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
    description: 'Current stock levels and item catalog',
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

function ExportCardItem({ card, onError }: { card: ExportCard; onError: (m: string) => void }) {
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);

  const handleDownloadCsv = async () => {
    setDownloadingCsv(true);
    try {
      await api.downloadExport(card.type, card.params);
    } catch (err: any) {
      onError(err?.message || `Failed to export ${card.title}`);
    } finally {
      setDownloadingCsv(false);
    }
  };

  const handleDownloadXlsx = async () => {
    setDownloadingXlsx(true);
    try {
      await api.downloadExport(card.type, { ...card.params, format: 'xlsx' });
    } catch (err: any) {
      onError(err?.message || `Failed to export ${card.title}`);
    } finally {
      setDownloadingXlsx(false);
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
      <div className="flex gap-2">
        <button
          onClick={handleDownloadCsv}
          disabled={downloadingCsv}
          className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm py-1.5"
        >
          {downloadingCsv ? (
            <span className="w-3.5 h-3.5 border-2 border-current/40 border-t-current rounded-full animate-spin" />
          ) : (
            <Download size={14} />
          )}
          CSV
        </button>
        <button
          onClick={handleDownloadXlsx}
          disabled={downloadingXlsx}
          className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm py-1.5"
        >
          {downloadingXlsx ? (
            <span className="w-3.5 h-3.5 border-2 border-current/40 border-t-current rounded-full animate-spin" />
          ) : (
            <Download size={14} />
          )}
          Excel
        </button>
      </div>
    </div>
  );
}

function ExportTab() {
  const [bundleDownloading, setBundleDownloading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const handleBundle = async () => {
    setBundleDownloading(true);
    try {
      await api.downloadExport('all');
    } catch (err: any) {
      showToast(err?.message || 'Failed to export data bundle', 'error');
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
          <ExportCardItem key={card.type} card={card} onError={(m) => showToast(m, 'error')} />
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

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
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
  const [pinUser, setPinUser] = useState<any | null>(null);
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
  // Managers can set operator floor PINs even though edit/delete stay developer-only.
  const canManagePins = isAtLeast('manager');
  const showActions = canManage || canManagePins;

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
                {showActions && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.id} className={`${!u.is_active ? 'opacity-50' : ''} hover:bg-gray-50/50`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}>
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
                  {showActions && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {canManagePins && u.role === 'operator' && (
                          <button onClick={() => setPinUser(u)}
                            title={u.has_pin ? 'PIN set — manage floor credentials' : 'Set floor PIN / badge'}
                            className={`p-1.5 rounded-lg transition-colors ${u.has_pin ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}>
                            <Key size={13} />
                          </button>
                        )}
                        {canManage && (
                          <button onClick={() => setModalUser(u)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                            <Edit2 size={13} />
                          </button>
                        )}
                        {canManage && u.id !== currentUser?.id && (
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
                        : <span className="text-gray-200">--</span>}
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
      {pinUser && (
        <PinModal
          user={pinUser}
          onClose={() => setPinUser(null)}
          onSaved={(msg) => { showToast(msg); load(); }}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// ─── Operator floor PIN / badge modal ─────────────────────────────────────────

function PinModal({ user, onClose, onSaved, onError }: {
  user: any;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [pin, setPin] = useState('');
  const [badge, setBadge] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (payload: { pin?: string | null; badge_code?: string | null }, successMsg: string) => {
    setError('');
    setSaving(true);
    try {
      await api.setUserPin(user.id, payload);
      onSaved(successMsg);
      onClose();
    } catch (err: any) {
      const msg = err.message || 'Failed to update credentials';
      setError(msg);
      onError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (pin && !/^\d{4,8}$/.test(pin)) { setError('PIN must be 4–8 digits'); return; }
    const payload: { pin?: string; badge_code?: string } = {};
    if (pin) payload.pin = pin;
    if (badge.trim()) payload.badge_code = badge.trim();
    if (!payload.pin && !payload.badge_code) { setError('Enter a PIN or a badge code'); return; }
    save(payload, `Floor credentials updated for ${user.display_name}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Key size={16} /> Floor PIN &amp; Badge</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="rounded-xl bg-blue-50/60 border border-blue-100 px-3.5 py-2.5 text-xs text-gray-600">
            Set a PIN so <span className="font-semibold text-gray-800">{user.display_name}</span> can clock into the Operator
            Portal on a shared tablet. Work is then attributed to their account.
            {user.has_pin && <span className="block mt-1 text-emerald-700 font-medium">A PIN is currently set.</span>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">New PIN (4–8 digits)</label>
            <div className="relative">
              <input
                className="input-field w-full pr-10 tracking-[0.3em] font-mono"
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="••••"
                autoFocus
              />
              <button type="button" onClick={() => setShowPin(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
                {showPin ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Badge code (optional)</label>
            <input
              className="input-field w-full"
              value={badge}
              onChange={e => setBadge(e.target.value)}
              placeholder="Scannable badge / card value"
            />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-1">
            {(user.has_pin || user.has_badge) && (
              <button
                type="button"
                onClick={() => save({ pin: null, badge_code: null }, `Floor credentials cleared for ${user.display_name}`)}
                disabled={saving}
                className="btn-secondary text-sm flex-shrink-0"
              >
                Clear
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex-1">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
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
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}>
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

// ─── Tab 7: Sites ─────────────────────────────────────────────────────────────

interface SiteForm {
  name: string;
  code: string;
  address: string;
  timezone: string;
  is_primary: boolean;
}

const DEFAULT_SITE_FORM: SiteForm = {
  name: '',
  code: '',
  address: '',
  timezone: 'America/New_York',
  is_primary: false,
};

function SiteModal({ site, onClose, onSaved, onError }: {
  site: Site | null;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const isEdit = !!site;
  const [form, setForm] = useState<SiteForm>(() => site ? {
    name: site.name ?? '',
    code: site.code ?? '',
    address: site.address ?? '',
    timezone: site.timezone || 'America/New_York',
    is_primary: !!site.is_primary,
  } : DEFAULT_SITE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof SiteForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Site name is required'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api.updateSite(site!.id, {
          name: form.name,
          code: form.code,
          address: form.address,
          timezone: form.timezone,
          ...(form.is_primary ? { is_primary: 1 } : {}),
        });
        onSaved('Site updated');
      } else {
        await api.createSite({ name: form.name, code: form.code, address: form.address, timezone: form.timezone });
        onSaved('Site created');
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save site');
      onError(err.message || 'Failed to save site');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">{isEdit ? 'Edit Site' : 'Add Site'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
            <input className="input-field w-full" value={form.name} onChange={set('name')} required placeholder="Main Plant" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Code</label>
            <input className="input-field w-full" value={form.code} onChange={set('code')} placeholder="MAIN" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
            <textarea className="input-field w-full resize-none" rows={2} value={form.address} onChange={set('address')} placeholder="123 Main St, Springfield, IL 62701" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Timezone</label>
            <select className="input-field w-full" value={form.timezone} onChange={set('timezone')}>
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          {isEdit && !site!.is_primary && (
            <div className="flex items-center justify-between py-1">
              <div>
                <div className="text-sm font-medium text-gray-800">Set as primary site</div>
                <div className="text-xs text-gray-500 mt-0.5">The primary site is the default for company-wide views</div>
              </div>
              <Toggle checked={form.is_primary} onChange={(v) => setForm(f => ({ ...f, is_primary: v }))} />
            </div>
          )}
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Site'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SitesTab() {
  const [sites, setSites] = useState<Site[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [loadingSites, setLoadingSites] = useState(true);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [loadingStations, setLoadingStations] = useState(false);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [selectedDept, setSelectedDept] = useState<any | null>(null);
  const [modalSite, setModalSite] = useState<Site | null | false>(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [addingDept, setAddingDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');
  const [savingDept, setSavingDept] = useState(false);
  const [addingStation, setAddingStation] = useState(false);
  const [newStationName, setNewStationName] = useState('');
  const [savingStation, setSavingStation] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const loadSites = (keepSelected?: boolean) => {
    setLoadingSites(true);
    api.getSites()
      .then(data => {
        setSites(data);
        if (!keepSelected) {
          const primary = data.find((s: Site) => s.is_primary) ?? data[0];
          if (primary) { setSelectedSite(primary); loadDepts(primary.id); }
        } else if (selectedSite) {
          const refreshed = data.find((s: Site) => s.id === selectedSite.id);
          if (refreshed) setSelectedSite(refreshed);
        }
      })
      .catch(() => setSites([]))
      .finally(() => setLoadingSites(false));
  };

  const loadDepts = (siteId: string) => {
    setLoadingDepts(true);
    api.getDepartments({ site_id: siteId })
      .then(setDepts)
      .catch(() => setDepts([]))
      .finally(() => setLoadingDepts(false));
  };

  const loadStations = (deptId: string) => {
    setLoadingStations(true);
    api.getStations({ department_id: deptId })
      .then(setStations)
      .catch(() => setStations([]))
      .finally(() => setLoadingStations(false));
  };

  useEffect(() => { loadSites(); }, []);

  const handleSelectSite = (site: Site) => {
    setSelectedSite(site);
    setSelectedDept(null);
    setStations([]);
    setAddingDept(false);
    setAddingStation(false);
    loadDepts(site.id);
  };

  const handleSelectDept = (dept: any) => {
    setSelectedDept(dept);
    setAddingStation(false);
    loadStations(dept.id);
  };

  const handleAddDept = async () => {
    if (!newDeptName.trim() || !selectedSite) return;
    setSavingDept(true);
    try {
      await api.createDepartment({ name: newDeptName.trim(), site_id: selectedSite.id });
      setNewDeptName(''); setAddingDept(false);
      loadDepts(selectedSite.id);
    } catch (err: any) { showToast(err.message || 'Failed to add department', 'error'); }
    finally { setSavingDept(false); }
  };

  const handleDeleteDept = async (id: string, name: string) => {
    if (!confirm(`Delete department "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await api.deleteDepartment(id);
      if (selectedDept?.id === id) { setSelectedDept(null); setStations([]); }
      if (selectedSite) loadDepts(selectedSite.id);
    } catch (err: any) { showToast(err.message || 'Failed to delete department', 'error'); }
    finally { setDeletingId(null); }
  };

  const handleAddStation = async () => {
    if (!newStationName.trim() || !selectedDept) return;
    setSavingStation(true);
    try {
      await api.createStation({ name: newStationName.trim(), department_id: selectedDept.id, site_id: selectedSite!.id });
      setNewStationName(''); setAddingStation(false);
      loadStations(selectedDept.id);
    } catch (err: any) { showToast(err.message || 'Failed to add workstation', 'error'); }
    finally { setSavingStation(false); }
  };

  const handleDeleteStation = async (id: string, name: string) => {
    if (!confirm(`Delete workstation "${name}"?`)) return;
    setDeletingId(id);
    try {
      await api.deleteStation(id);
      if (selectedDept) loadStations(selectedDept.id);
    } catch (err: any) { showToast(err.message || 'Failed to delete workstation', 'error'); }
    finally { setDeletingId(null); }
  };

  const handleDeleteSite = async (site: Site) => {
    if (!confirm(`Delete site "${site.name}"? This cannot be undone.`)) return;
    setDeletingId(site.id);
    try {
      await api.deleteSite(site.id);
      showToast(`Site "${site.name}" deleted`);
      if (selectedSite?.id === site.id) { setSelectedSite(null); setDepts([]); setStations([]); }
      loadSites(true);
    } catch (err: any) { showToast(err.message || 'Failed to delete site', 'error'); }
    finally { setDeletingId(null); }
  };

  const colCls = 'flex flex-col border border-gray-100 rounded-xl overflow-hidden bg-white shadow-sm';
  const headCls = 'flex items-center justify-between px-3 py-2.5 bg-gray-50 border-b border-gray-100 flex-shrink-0';
  const emptyCls = 'p-6 text-center text-xs text-gray-400 flex flex-col items-center gap-2 flex-1 justify-center';

  return (
    <div className="max-w-5xl space-y-4">
      <div className="rounded-xl bg-blue-50/60 border border-blue-100 p-3.5 flex items-start gap-2.5">
        <Network size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-gray-600 leading-relaxed">
          <span className="font-semibold text-gray-800">Build your facility hierarchy here.</span>
          {' '}Click a <span className="font-medium text-gray-700">Site</span> to see its departments,
          then click a <span className="font-medium text-gray-700">Department</span> to manage its workstations.
          Apps and work orders are then assigned to these.
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3" style={{ height: 500 }}>
        {/* Column 1: Sites */}
        <div className={colCls}>
          <div className={headCls}>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sites</span>
            <button onClick={() => setModalSite(null)} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              <Plus size={11} /> Add
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingSites ? (
              <div className={emptyCls}>Loading…</div>
            ) : sites.length === 0 ? (
              <div className={emptyCls}>
                <MapPin size={22} className="text-gray-200" />
                Add your first site to get started
              </div>
            ) : sites.map(site => (
              <button
                key={site.id}
                onClick={() => handleSelectSite(site)}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-gray-50 transition-colors group ${
                  selectedSite?.id === site.id ? 'bg-[var(--accent)] text-white' : 'hover:bg-gray-50'
                }`}
              >
                <MapPin size={13} className="flex-shrink-0 opacity-70" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{site.name}</div>
                  <div className={`text-[10px] truncate ${selectedSite?.id === site.id ? 'text-white/70' : 'text-gray-400'}`}>
                    {site.code ? `${site.code} · ` : ''}{site.department_count ?? 0} dept{(site.department_count ?? 0) !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!!site.is_primary && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full mr-1 ${selectedSite?.id === site.id ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                      PRIMARY
                    </span>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); setModalSite(site); }}
                    className={`p-1 rounded ${selectedSite?.id === site.id ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                  >
                    <Edit2 size={11} />
                  </button>
                  {!site.is_primary && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteSite(site); }}
                      disabled={deletingId === site.id}
                      className={`p-1 rounded ${selectedSite?.id === site.id ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
                {!!site.is_primary && selectedSite?.id !== site.id && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0 group-hover:hidden">
                    PRIMARY
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Column 2: Departments */}
        <div className={colCls}>
          <div className={headCls}>
            <div className="min-w-0 flex items-center gap-1.5 overflow-hidden">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-shrink-0">Departments</span>
              {selectedSite && <span className="text-xs text-gray-400 truncate">· {selectedSite.name}</span>}
            </div>
            {selectedSite && (
              <button onClick={() => setAddingDept(a => !a)} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 flex-shrink-0 ml-2">
                <Plus size={11} /> Add
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {!selectedSite ? (
              <div className={emptyCls}>
                <ChevronRight size={22} className="text-gray-200" />
                Select a site first
              </div>
            ) : loadingDepts ? (
              <div className={emptyCls}>Loading…</div>
            ) : depts.length === 0 && !addingDept ? (
              <div className={emptyCls}>
                <Building2 size={22} className="text-gray-200" />
                No departments yet — click Add
              </div>
            ) : depts.map(dept => (
              <button
                key={dept.id}
                onClick={() => handleSelectDept(dept)}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-gray-50 transition-colors group ${
                  selectedDept?.id === dept.id ? 'bg-[var(--accent)] text-white' : 'hover:bg-gray-50'
                }`}
              >
                <Building2 size={13} className="flex-shrink-0 opacity-70" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{dept.name}</div>
                  {dept.description && (
                    <div className={`text-[10px] truncate ${selectedDept?.id === dept.id ? 'text-white/70' : 'text-gray-400'}`}>{dept.description}</div>
                  )}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleDeleteDept(dept.id, dept.name); }}
                  disabled={deletingId === dept.id}
                  className={`p-1 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${
                    selectedDept?.id === dept.id ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                  }`}
                >
                  <Trash2 size={11} />
                </button>
              </button>
            ))}
          </div>
          {selectedSite && addingDept && (
            <div className="border-t border-gray-100 p-2.5 flex-shrink-0 space-y-1.5">
              <input
                className="input-field w-full text-xs"
                placeholder="Department name (e.g. Assembly)"
                value={newDeptName}
                onChange={e => setNewDeptName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddDept(); if (e.key === 'Escape') setAddingDept(false); }}
                autoFocus
              />
              <div className="flex gap-1.5">
                <button onClick={handleAddDept} disabled={!newDeptName.trim() || savingDept} className="btn-primary text-xs py-1 px-3 flex-1">
                  {savingDept ? 'Saving…' : 'Add Department'}
                </button>
                <button onClick={() => { setAddingDept(false); setNewDeptName(''); }} className="text-xs text-gray-400 hover:text-gray-600 px-2">✕</button>
              </div>
            </div>
          )}
        </div>

        {/* Column 3: Workstations */}
        <div className={colCls}>
          <div className={headCls}>
            <div className="min-w-0 flex items-center gap-1.5 overflow-hidden">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-shrink-0">Workstations</span>
              {selectedDept && <span className="text-xs text-gray-400 truncate">· {selectedDept.name}</span>}
            </div>
            {selectedDept && (
              <button onClick={() => setAddingStation(a => !a)} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 flex-shrink-0 ml-2">
                <Plus size={11} /> Add
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {!selectedDept ? (
              <div className={emptyCls}>
                <Cpu size={22} className="text-gray-200" />
                Select a department first
              </div>
            ) : loadingStations ? (
              <div className={emptyCls}>Loading…</div>
            ) : stations.length === 0 && !addingStation ? (
              <div className={emptyCls}>
                <Cpu size={22} className="text-gray-200" />
                No workstations yet — click Add
              </div>
            ) : stations.map(s => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 group">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Cpu size={13} className="text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-700 font-medium truncate">{s.name}</span>
                </div>
                <button
                  onClick={() => handleDeleteStation(s.id, s.name)}
                  disabled={deletingId === s.id}
                  className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
          {selectedDept && addingStation && (
            <div className="border-t border-gray-100 p-2.5 flex-shrink-0 space-y-1.5">
              <input
                className="input-field w-full text-xs"
                placeholder="Workstation name (e.g. Station A-1)"
                value={newStationName}
                onChange={e => setNewStationName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddStation(); if (e.key === 'Escape') setAddingStation(false); }}
                autoFocus
              />
              <div className="flex gap-1.5">
                <button onClick={handleAddStation} disabled={!newStationName.trim() || savingStation} className="btn-primary text-xs py-1 px-3 flex-1">
                  {savingStation ? 'Saving…' : 'Add Workstation'}
                </button>
                <button onClick={() => { setAddingStation(false); setNewStationName(''); }} className="text-xs text-gray-400 hover:text-gray-600 px-2">✕</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {modalSite !== false && (
        <SiteModal
          site={modalSite}
          onClose={() => setModalSite(false)}
          onSaved={(msg) => { showToast(msg); loadSites(true); }}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// ─── Tab 8: Notifications ─────────────────────────────────────────────────────

function NotificationsTab() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saved, setSaved] = useState<NotificationPrefs | null>(null);
  const [log, setLog] = useState<NotificationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([api.getNotificationPrefs(), api.getNotificationLog(20)])
      .then(([p, l]) => {
        setPrefs(p);
        setSaved(p);
        setLog(l);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const isDirty = JSON.stringify(prefs) !== JSON.stringify(saved);

  const toggleEvent = (key: string) => {
    if (!prefs) return;
    const has = prefs.events.includes(key);
    setPrefs({ ...prefs, events: has ? prefs.events.filter(e => e !== key) : [...prefs.events, key] });
  };

  const handleSave = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const updated = await api.updateNotificationPrefs({
        email_enabled: prefs.email_enabled,
        email_to: prefs.email_to,
        sms_enabled: prefs.sms_enabled,
        sms_to: prefs.sms_to,
        events: prefs.events,
      });
      setPrefs(updated);
      setSaved(updated);
      showToast('Notification preferences saved');
    } catch (err: any) {
      showToast(err.message || 'Failed to save preferences', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result: any = await api.sendTestNotification();
      showToast(result?.message || 'Test notification sent');
      api.getNotificationLog(20).then(setLog).catch(() => {});
    } catch (err: any) {
      showToast(err.message || 'Failed to send test notification', 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading || !prefs) {
    return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading notification settings…</div>;
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Channel status */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 ${
          prefs.email_configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
        }`}>
          <Mail size={12} />
          {prefs.email_configured ? 'Email -- Configured' : 'Email -- Demo mode (will log instead of send)'}
        </span>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 ${
          prefs.sms_configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
        }`}>
          <MessageSquare size={12} />
          {prefs.sms_configured ? 'SMS -- Configured' : 'SMS -- Demo mode (will log instead of send)'}
        </span>
      </div>

      {/* Email */}
      <div>
        <SectionHeader title="Email Alerts" subtitle="Send email notifications for selected events" />
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-gray-800">Enable email notifications</div>
            </div>
            <Toggle checked={prefs.email_enabled} onChange={(v) => setPrefs(p => p ? { ...p, email_enabled: v } : p)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Recipients</label>
            <input
              className="input-field w-full"
              value={prefs.email_to}
              onChange={e => setPrefs(p => p ? { ...p, email_to: e.target.value } : p)}
              placeholder="ops@company.com, manager@company.com"
            />
            <p className="text-xs text-gray-400 mt-1">Comma-separated email addresses</p>
          </div>
        </div>
      </div>

      {/* SMS */}
      <div>
        <SectionHeader title="SMS Alerts" subtitle="Send text message notifications for selected events" />
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-gray-800">Enable SMS notifications</div>
            </div>
            <Toggle checked={prefs.sms_enabled} onChange={(v) => setPrefs(p => p ? { ...p, sms_enabled: v } : p)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Recipients</label>
            <input
              className="input-field w-full"
              value={prefs.sms_to}
              onChange={e => setPrefs(p => p ? { ...p, sms_to: e.target.value } : p)}
              placeholder="+15551234567"
            />
            <p className="text-xs text-gray-400 mt-1">Comma-separated phone numbers, e.g. +15551234567</p>
          </div>
        </div>
      </div>

      {/* Event subscriptions */}
      <div>
        <SectionHeader title="Event Subscriptions" subtitle="Choose which events trigger notifications" />
        <div className="divide-y divide-gray-50">
          {Object.entries(prefs.available_events).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between py-2.5 gap-4 cursor-pointer">
              <span className="text-sm text-gray-700">{label}</span>
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300"
                checked={prefs.events.includes(key)}
                onChange={() => toggleEvent(key)}
                style={{ accentColor: 'var(--accent)' }}
              />
            </label>
          ))}
        </div>
      </div>

      {/* Save / Test */}
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center justify-center gap-2">
          {saving ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Saving…</> : <><Check size={15} />Save</>}
        </button>
        <button onClick={handleTest} disabled={testing} className="btn-secondary flex items-center justify-center gap-2">
          {testing ? <><span className="w-4 h-4 border-2 border-current/40 border-t-current rounded-full animate-spin" />Sending…</> : <><Send size={14} />Send Test Notification</>}
        </button>
        {isDirty && (
          <span className="text-xs text-amber-600 whitespace-nowrap flex items-center gap-1">
            <AlertCircle size={12} /> Unsaved changes
          </span>
        )}
      </div>

      {/* Recent notifications */}
      <div>
        <SectionHeader title="Recent Notifications" subtitle="Last 20 notification attempts" />
        {log.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
            <Bell size={24} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">No notifications sent yet</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Event</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Channel</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Recipient</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {log.map(entry => (
                  <tr key={entry.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-gray-700">{prefs.available_events[entry.event] ?? entry.event}</td>
                    <td className="px-4 py-2.5 text-gray-500">
                      <span className="inline-flex items-center gap-1.5">
                        {entry.channel === 'email' ? <Mail size={12} /> : <MessageSquare size={12} />}
                        {entry.channel.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{entry.recipient}</td>
                    <td className="px-4 py-2.5 text-center">
                      {entry.status === 'sent' && (
                        <span title="Sent" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                          <CheckCircle2 size={14} /> Sent
                        </span>
                      )}
                      {entry.status === 'simulated' && (
                        <span title="Demo mode -- logged instead of sent" className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                          <AlertCircle size={14} /> Simulated
                        </span>
                      )}
                      {entry.status === 'failed' && (
                        <span title="Failed to send" className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
                          <XCircle size={14} /> Failed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(entry.created_at + 'Z').toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// ─── Tab 9: Permissions ───────────────────────────────────────────────────────

const ROLE_LEVELS: Record<string, number> = { manager: 4, supervisor: 3, operator: 2, viewer: 1 };
const PERM_ROLES: AppRole[] = ['manager', 'supervisor', 'operator', 'viewer'];

function PermissionsTab() {
  const [permissions, setPermissions] = useState<RolePermissionMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoading(true);
    api.getPermissions()
      .then(setPermissions)
      .catch(() => setPermissions(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const handleToggle = async (role: AppRole, item: typeof ALL_SECTION_ITEMS[number]) => {
    if (!permissions) return;
    const defaultVisible = !item.minRole || (ROLE_LEVELS[role] ?? 0) >= (ROLE_LEVELS[item.minRole] ?? 99);
    const effective = permissions[role]?.[item.to] !== undefined ? !!permissions[role][item.to] : defaultVisible;
    const next = !effective;
    const visible = next === defaultVisible ? null : next;
    const key = `${role}:${item.to}`;
    setBusyKey(key);
    try {
      const updated = await api.updatePermissions([{ role, nav_key: item.to, visible }]);
      setPermissions(updated);
    } catch (err: any) {
      showToast(err.message || 'Failed to update permission', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset all role permission overrides to their defaults?')) return;
    try {
      const updated = await api.resetPermissions();
      setPermissions(updated);
      showToast('Permissions reset to defaults');
    } catch (err: any) {
      showToast(err.message || 'Failed to reset permissions', 'error');
    }
  };

  if (loading || !permissions) {
    return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading permissions…</div>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start gap-2.5 text-xs bg-blue-50 text-blue-800 rounded-xl px-3.5 py-2.5 border border-blue-100">
        <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
        <span>
          Toggle which navigation items each role can see, beyond the built-in defaults.
          A grey/default cell means the item follows its normal role requirement.
        </span>
      </div>

      <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Navigation Item</th>
              {PERM_ROLES.map(role => (
                <th key={role} className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 capitalize">{role}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {ALL_SECTION_ITEMS.map(item => (
              <tr key={item.to} className="hover:bg-gray-50/50">
                <td className="px-4 py-2.5 text-gray-700 flex items-center gap-2">
                  <item.icon size={14} className="text-gray-400" />
                  {item.label}
                </td>
                {PERM_ROLES.map(role => {
                  const defaultVisible = !item.minRole || (ROLE_LEVELS[role] ?? 0) >= (ROLE_LEVELS[item.minRole] ?? 99);
                  const override = permissions[role]?.[item.to];
                  const effective = override !== undefined ? !!override : defaultVisible;
                  const isOverridden = override !== undefined;
                  const key = `${role}:${item.to}`;
                  return (
                    <td key={role} className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <span className={isOverridden ? '' : 'opacity-50'}>
                          <Toggle
                            checked={effective}
                            onChange={() => busyKey ? undefined : handleToggle(role, item)}
                          />
                        </span>
                        {busyKey === key && (
                          <span className="w-3 h-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin inline-block" />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-100">
        <p className="text-xs text-gray-500">
          Changes apply immediately to the relevant role's sidebar.
        </p>
        <button onClick={handleReset} className="btn-secondary text-sm whitespace-nowrap flex items-center gap-1.5">
          <RotateCcw size={13} /> Reset All to Defaults
        </button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// ─── Tab 10: Developer (Enterprise) ───────────────────────────────────────────

function NewApiKeyModal({ onClose, onCreated, onError }: {
  onClose: () => void;
  onCreated: (key: ApiKey & { key: string }) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      const created = await api.createApiKey(name.trim());
      onCreated(created);
    } catch (err: any) {
      setError(err.message || 'Failed to create API key');
      onError(err.message || 'Failed to create API key');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Generate New API Key</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
            <input className="input-field w-full" value={name} onChange={e => setName(e.target.value)} required placeholder="ERP Integration" autoFocus />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Generating…' : 'Generate Key'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RevealKeyModal({ apiKey, onClose }: { apiKey: ApiKey & { key: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">API Key Created</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-2.5 text-xs bg-amber-50 text-amber-800 rounded-xl px-3.5 py-2.5 border border-amber-100">
            <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
            <span>This key will only be shown once -- copy it now. You won't be able to view it again.</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{apiKey.name}</label>
            <div className="flex items-center gap-2">
              <code className="input-field w-full font-mono text-xs break-all">{apiKey.key}</code>
              <button onClick={handleCopy} type="button" className="btn-secondary flex-shrink-0 px-3 py-2.5 flex items-center gap-1.5 text-xs">
                <Copy size={13} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <button onClick={onClose} className="btn-primary w-full">Done</button>
        </div>
      </div>
    </div>
  );
}

function WebhookModal({ webhook, availableEvents, onClose, onSaved, onError }: {
  webhook: Webhook | null;
  availableEvents: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const isEdit = !!webhook;
  const [name, setName] = useState(webhook?.name ?? '');
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [events, setEvents] = useState<string[]>(webhook?.events ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleEvent = (key: string) => {
    if (key === '*') {
      setEvents(prev => prev.includes('*') ? [] : ['*']);
      return;
    }
    setEvents(prev => {
      const withoutAll = prev.filter(e => e !== '*');
      return withoutAll.includes(key) ? withoutAll.filter(e => e !== key) : [...withoutAll, key];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if (!url.trim()) { setError('URL is required'); return; }
    if (events.length === 0) { setError('Select at least one event'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api.updateWebhook(webhook!.id, { name, url, events });
        onSaved('Webhook updated');
      } else {
        await api.createWebhook({ name, url, events });
        onSaved('Webhook created');
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save webhook');
      onError(err.message || 'Failed to save webhook');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-800">{isEdit ? 'Edit Webhook' : 'Add Webhook'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
            <input className="input-field w-full" value={name} onChange={e => setName(e.target.value)} required placeholder="ERP Sync" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">URL</label>
            <input type="url" className="input-field w-full" value={url} onChange={e => setUrl(e.target.value)} required placeholder="https://example.com/webhooks/hartmonitor" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Events</label>
            <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg max-h-56 overflow-y-auto">
              {availableEvents.map(key => (
                <label key={key} className="flex items-center justify-between py-2 px-3 gap-4 cursor-pointer text-sm">
                  <span className="text-gray-700">{key === '*' ? 'All events' : key}</span>
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300"
                    checked={events.includes(key) || (key !== '*' && events.includes('*'))}
                    onChange={() => toggleEvent(key)}
                    disabled={key !== '*' && events.includes('*')}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Webhook'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function WebhookDeliveriesModal({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getWebhookDeliveries(webhook.id)
      .then(setDeliveries)
      .catch(() => setDeliveries([]))
      .finally(() => setLoading(false));
  }, [webhook.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-800">Deliveries -- {webhook.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">Loading deliveries…</div>
          ) : deliveries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
              <p className="text-sm text-gray-400">No deliveries yet</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Event</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Status</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Result</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Error</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {deliveries.map(d => (
                    <tr key={d.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 text-gray-700">{d.event}</td>
                      <td className="px-4 py-2.5 text-center text-gray-600">{d.status_code ?? '--'}</td>
                      <td className="px-4 py-2.5 text-center">
                        {d.success
                          ? <CheckCircle2 size={14} className="text-emerald-500 inline" />
                          : <XCircle size={14} className="text-red-500 inline" />}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{d.error || '--'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                        {new Date(d.created_at + 'Z').toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Stripe / SSO setup helper — shows live-vs-demo status and the exact URLs an
// admin must register with each provider. Visible to managers regardless of plan.
function IntegrationsPanel() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getIntegrations>> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { api.getIntegrations().then(setData).catch(() => {}); }, []);

  const copy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  };

  if (!data) return null;

  const StatusBadge = ({ live }: { live: boolean }) => (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
      live ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
    }`}>
      {live ? 'Live' : 'Demo'}
    </span>
  );

  const CopyRow = ({ label, value, id }: { label: string; value: string; id: string }) => (
    <div>
      <div className="text-[11px] font-medium text-gray-400 mb-0.5">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate font-mono text-xs bg-gray-100 px-2 py-1.5 rounded-lg text-gray-700">{value}</code>
        <button onClick={() => copy(value, id)} className="btn-secondary text-xs flex items-center gap-1 flex-shrink-0">
          <Copy size={12} /> {copied === id ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <SectionHeader title="Integrations" subtitle="Connect real payments and single sign-on. Add the credentials to your host's environment variables, then redeploy." />

      {!data.app_url_explicit && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Set the <code className="font-mono">APP_URL</code> environment variable to your real public URL so these callback/webhook URLs are correct.</span>
        </div>
      )}

      {/* Payments */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard size={16} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-800">Payments (Stripe)</span>
          </div>
          <StatusBadge live={data.payments.configured} />
        </div>
        {!data.payments.configured && (
          <p className="text-xs text-gray-500">
            Create a Stripe webhook pointing at the URL below (events: {data.payments.events.join(', ')}),
            then set {data.payments.env_vars.map((v, i) => (
              <span key={v}>{i > 0 ? ' and ' : ''}<code className="font-mono bg-gray-100 px-1 rounded">{v}</code></span>
            ))} in your host and redeploy.
          </p>
        )}
        <CopyRow label="Webhook endpoint URL" value={data.payments.webhook_url} id="stripe-webhook" />
      </div>

      {/* SSO */}
      {data.sso.map(p => (
        <div key={p.id} className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe size={16} className="text-gray-500" />
              <span className="text-sm font-semibold text-gray-800">{p.name} Sign-In (SSO)</span>
            </div>
            <StatusBadge live={p.configured} />
          </div>
          {!p.configured && (
            <p className="text-xs text-gray-500">
              Register an OAuth app with {p.name}, add the redirect URI below, then set{' '}
              {p.env_vars.map((v, i) => (
                <span key={v}>{i > 0 ? ' and ' : ''}<code className="font-mono bg-gray-100 px-1 rounded">{v}</code></span>
              ))} in your host and redeploy.
            </p>
          )}
          <CopyRow label="Authorized redirect URI" value={p.redirect_uri} id={`sso-${p.id}`} />
        </div>
      ))}
    </div>
  );
}

function DeveloperTab() {
  const [availability, setAvailability] = useState<{ available: boolean; events: string[] } | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewKey, setShowNewKey] = useState(false);
  const [revealKey, setRevealKey] = useState<(ApiKey & { key: string }) | null>(null);
  const [modalWebhook, setModalWebhook] = useState<Webhook | null | false>(false);
  const [deliveriesWebhook, setDeliveriesWebhook] = useState<Webhook | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoading(true);
    api.getDeveloperAvailability()
      .then(avail => {
        setAvailability(avail);
        if (avail.available) {
          return Promise.all([api.getApiKeys(), api.getWebhooks()]).then(([keys, hooks]) => {
            setApiKeys(keys);
            setWebhooks(hooks);
          });
        }
      })
      .catch(() => setAvailability({ available: false, events: [] }))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const loadKeys = () => api.getApiKeys().then(setApiKeys).catch(() => {});
  const loadWebhooks = () => api.getWebhooks().then(setWebhooks).catch(() => {});

  const handleDeleteKey = async (key: ApiKey) => {
    if (!confirm(`Delete API key "${key.name}"? Any integrations using it will stop working.`)) return;
    try {
      await api.deleteApiKey(key.id);
      showToast('API key deleted');
      loadKeys();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete API key', 'error');
    }
  };

  const handleDeleteWebhook = async (hook: Webhook) => {
    if (!confirm(`Delete webhook "${hook.name}"?`)) return;
    try {
      await api.deleteWebhook(hook.id);
      showToast('Webhook deleted');
      loadWebhooks();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete webhook', 'error');
    }
  };

  const handleTestWebhook = async (hook: Webhook) => {
    try {
      const result: any = await api.testWebhook(hook.id);
      showToast(result?.success === false ? (result?.error || 'Webhook test failed') : 'Webhook test sent', result?.success === false ? 'error' : 'success');
    } catch (err: any) {
      showToast(err.message || 'Webhook test failed', 'error');
    }
  };

  if (loading || !availability) {
    return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading…</div>;
  }

  if (!availability.available) {
    return (
      <div className="max-w-3xl space-y-8">
        <IntegrationsPanel />
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <Crown size={22} />
          </div>
          <h3 className="text-base font-semibold text-gray-800 mb-1.5">API Access &amp; Webhooks — Enterprise</h3>
          <p className="text-sm text-gray-600 max-w-md mx-auto">
            API keys and outbound webhooks for ERP / external system integration are available on the
            Enterprise plan. Generate API keys for the read-only REST API and configure webhooks
            to push real-time events to your other systems.
          </p>
          <p className="text-xs text-gray-500 mt-3">
            Visit the <span className="font-semibold">Plan &amp; Billing</span> tab to upgrade.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <IntegrationsPanel />

      {/* API info card */}
      <div className="card p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
            <Code size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-800">Enterprise REST API</div>
            <p className="text-xs text-gray-500 mt-0.5">
              Read-only API for integrating with ERP and other external systems.
              Base URL: <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">/api/v1</code>.
              Authenticate with <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">Authorization: Bearer &lt;api-key&gt;</code>.
            </p>
            <ul className="text-xs text-gray-600 mt-2 space-y-1 font-mono">
              <li><span className="text-emerald-600 font-semibold">GET</span> /api/v1/work-orders</li>
              <li><span className="text-emerald-600 font-semibold">GET</span> /api/v1/completions</li>
              <li><span className="text-emerald-600 font-semibold">GET</span> /api/v1/inventory</li>
            </ul>
          </div>
        </div>
      </div>

      {/* API Keys */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionHeader title="API Keys" subtitle="Generate keys to authenticate requests to the Enterprise API" />
          <button onClick={() => setShowNewKey(true)} className="btn-primary flex items-center gap-2 text-sm flex-shrink-0 -mt-5">
            <Plus size={14} /> Generate New Key
          </button>
        </div>
        {apiKeys.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center">
            <Key size={20} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">No API keys yet</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Name</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Key</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Last Used</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Created</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {apiKeys.map(key => (
                  <tr key={key.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-gray-800 font-medium">{key.name}</td>
                    <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{key.key_prefix}••••••••</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{key.last_used_at ? new Date(key.last_used_at + 'Z').toLocaleString() : 'Never'}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{new Date(key.created_at + 'Z').toLocaleDateString()}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <button onClick={() => handleDeleteKey(key)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Webhooks */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionHeader title="Webhooks" subtitle="Push real-time events to an external URL" />
          <button onClick={() => setModalWebhook(null)} className="btn-primary flex items-center gap-2 text-sm flex-shrink-0 -mt-5">
            <Plus size={14} /> Add Webhook
          </button>
        </div>
        {webhooks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center">
            <WebhookIcon size={20} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">No webhooks configured</p>
          </div>
        ) : (
          <div className="space-y-3">
            {webhooks.map(hook => (
              <div key={hook.id} className="card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800">{hook.name}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${hook.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {hook.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{hook.url}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {hook.events.includes('*') ? 'All events' : hook.events.join(', ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setDeliveriesWebhook(hook)} title="View Deliveries"
                      className="px-2 py-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors text-xs font-medium flex items-center gap-1">
                      <Activity size={13} /> Deliveries
                    </button>
                    <button onClick={() => handleTestWebhook(hook)} title="Test"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                      <Send size={13} />
                    </button>
                    <button onClick={() => setModalWebhook(hook)} title="Edit"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDeleteWebhook(hook)} title="Delete"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNewKey && (
        <NewApiKeyModal
          onClose={() => setShowNewKey(false)}
          onCreated={(created) => { setShowNewKey(false); setRevealKey(created); loadKeys(); }}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}
      {revealKey && <RevealKeyModal apiKey={revealKey} onClose={() => setRevealKey(null)} />}
      {modalWebhook !== false && (
        <WebhookModal
          webhook={modalWebhook}
          availableEvents={availability.events}
          onClose={() => setModalWebhook(false)}
          onSaved={(msg) => { showToast(msg); loadWebhooks(); }}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}
      {deliveriesWebhook && (
        <WebhookDeliveriesModal webhook={deliveriesWebhook} onClose={() => setDeliveriesWebhook(null)} />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// ─── Help & Guides tab ────────────────────────────────────────────────────────

interface ModuleGuide {
  icon: React.ReactNode;
  title: string;
  summary: string;
  link: string;
  linkLabel: string;
  steps: string[];
  tips: string[];
  color: string;
}

const MODULE_GUIDES: ModuleGuide[] = [
  {
    icon: <Activity size={16} />,
    title: 'Command Center',
    summary: 'Your home dashboard -- everything that needs attention in one place.',
    link: '/dashboard',
    linkLabel: 'Open Command Center',
    color: '#3b82f6',
    steps: [
      'The top row shows today\'s output, pass rate, and active work orders at a glance.',
      'Overdue work orders and open quality alerts are surfaced automatically.',
      'Click any metric card to drill into the detail page for that area.',
      'Live throughput updates every 30 seconds via WebSocket -- no refresh needed.',
    ],
    tips: [
      'Check here first thing each shift to spot problems early.',
      'The "Quick Actions" panel lets you log a downtime event or create a work order without leaving the dashboard.',
    ],
  },
  {
    icon: <Tablet size={16} />,
    title: 'Operator Portal',
    summary: 'The dedicated full-screen screen your operators use on the shop floor.',
    link: '/operator',
    linkLabel: 'Open Operator Portal',
    color: '#10b981',
    steps: [
      'Click the blue "Operator Portal" launcher in the sidebar -- it opens full-screen.',
      'The operator selects their name, then picks a Work Order and App to run.',
      'They follow the step-by-step guided instructions (checkboxes, inputs, pass/fail).',
      'On completion the record is saved, OEE data is logged, and the next job loads.',
      'Operators can also report a quality issue (NCR) directly from any step.',
    ],
    tips: [
      'Set this up on a dedicated tablet or touchscreen at each workstation.',
      'The portal works offline -- completions sync when the connection restores.',
    ],
  },
  {
    icon: <AppWindow size={16} />,
    title: 'App Library & Builder',
    summary: 'Build and publish digital work instructions for your production processes.',
    link: '/apps',
    linkLabel: 'Open App Library',
    color: '#8b5cf6',
    steps: [
      'Go to App Library → click "New App" to start building.',
      'Add Steps (one per major task) using the "+" button.',
      'Drag widgets into each step: text instructions, checkboxes, number inputs, pass/fail, photos, timers, etc.',
      'Preview the app at any time with the "Preview" button to see exactly what operators will see.',
      'Click "Publish" to make it live -- published apps appear in the Operator Portal immediately.',
    ],
    tips: [
      'Keep each step focused on one task. Too many widgets per step = confused operators.',
      'Use the "Instruction" widget with a yellow background to highlight safety warnings.',
      'Set takt times per step -- the system tracks if operators exceed the target.',
    ],
  },
  {
    icon: <Building2 size={16} />,
    title: 'Command Center / Live Floor View',
    summary: 'See the live status of your entire floor and manage your work centers.',
    link: '/dashboard',
    linkLabel: 'Open Command Center',
    color: '#f59e0b',
    steps: [
      'Go to Stations → "New Station" to add each physical workstation on your floor.',
      'Assign an App to each station so operators always know what to run there.',
      'Organize stations into Departments (Assembly, QC, Packaging, etc.) for grouped views.',
      'The Command Center Live Floor View shows live throughput, OEE, and machine status for every station.',
      'Click any station card to see its real-time metrics and recent completions.',
    ],
    tips: [
      'Put the Command Center on a TV in the production area -- it auto-refreshes.',
      'Departments aggregate KPIs so managers can see section-level performance at a glance.',
    ],
  },
  {
    icon: <ClipboardList size={16} />,
    title: 'Work Orders & Schedule',
    summary: 'Plan and track production jobs from creation to completion.',
    link: '/schedule',
    linkLabel: 'Open Schedule',
    color: '#ec4899',
    steps: [
      'Go to Schedule → "New Work Order" and enter part number, quantity, and due date.',
      'Assign a Department and takt time target so the system can track pace vs. plan.',
      'Set priority (Critical / High / Medium / Low) -- overdue high-priority WOs show red in the dashboard.',
      'As operators complete jobs in the portal, quantity_completed updates automatically.',
      'Manager View gives a drag-and-drop calendar view of all open work orders by department.',
    ],
    tips: [
      'Takt time is the "goal" cycle time per unit. Set it accurately for meaningful OEE data.',
      'Use the "Overdue" filter in Schedule to find WOs that slipped past their end date.',
    ],
  },
  {
    icon: <Package size={16} />,
    title: 'Inventory',
    summary: 'Track raw materials, components, and finished goods across your warehouse locations.',
    link: '/inventory',
    linkLabel: 'Open Inventory',
    color: '#0ea5e9',
    steps: [
      'Create Locations first (Main Warehouse, Assembly Floor, QC Hold, Finished Goods).',
      'Add Items with SKU, unit cost, reorder point, and reorder quantity.',
      'Record stock movements: Receive (incoming PO), Consume (production), Adjust, Scrap.',
      'Items below their reorder point appear in red on the Inventory dashboard.',
      'Stock levels update instantly as movements are logged.',
    ],
    tips: [
      'Inventory is a Pro feature. Upgrade in Settings → Plan to unlock it.',
      'Link items to NCRs when scrapping defective stock to keep traceability.',
    ],
  },
  {
    icon: <ShoppingCart size={16} />,
    title: 'Purchasing',
    summary: 'Create and track purchase orders from draft to receiving.',
    link: '/purchasing',
    linkLabel: 'Open Purchasing',
    color: '#14b8a6',
    steps: [
      'Add Vendors first with contact details and payment terms.',
      'Create a Purchase Order, pick the vendor, and add line items (item + qty + cost).',
      'Change PO status: Draft → Sent → Received. When received, stock levels update automatically.',
      'PO history lets you compare actual vs. planned cost and lead times over time.',
    ],
    tips: [
      'Purchasing is a Pro feature. Reorder-point alerts show when to create a new PO.',
      'Set Lead Time Days on each vendor to anticipate when stock will arrive.',
    ],
  },
  {
    icon: <ShieldCheck size={16} />,
    title: 'Quality / NCR',
    summary: 'Track non-conformances, assign ownership, and drive corrective action.',
    link: '/quality',
    linkLabel: 'Open Quality',
    color: '#ef4444',
    steps: [
      'Create an NCR from the Quality page -- or operators can log one directly from the portal mid-job.',
      'Set severity (Minor, Major, Critical) and assign it to a team member.',
      'Investigate: record root cause and corrective action in the NCR detail.',
      'Add comments to keep a timestamped audit trail of the investigation.',
      'Close the NCR once corrective action is verified -- the history is preserved.',
    ],
    tips: [
      'Quality is a Pro feature. Link NCRs to work orders and inventory items for full traceability.',
      'The dashboard shows open critical NCRs front-and-center so nothing slips through.',
    ],
  },
  {
    icon: <BarChart3 size={16} />,
    title: 'Analytics & OEE',
    summary: 'Measure throughput, cycle time, and equipment effectiveness over time.',
    link: '/analytics',
    linkLabel: 'Open Analytics',
    color: '#6366f1',
    steps: [
      'Analytics → pick a date range to see throughput, cycle time, and pass rates by app and operator.',
      'OEE Tracker breaks down Availability, Performance, and Quality losses by station.',
      'Step Metrics shows per-step cycle times -- spot which step is the bottleneck.',
      'Leaderboard ranks operators by completed units -- great for gamification.',
      'Build custom Dashboards with cards for any combination of metrics.',
    ],
    tips: [
      'OEE < 85% is a flag. Dig into Availability (downtime), Performance (slow cycles), or Quality (rework) to find the root cause.',
      'Publish a Dashboard in "kiosk" mode to put live metrics on a production TV.',
    ],
  },
  {
    icon: <Bell size={16} />,
    title: 'Alerts & Messages',
    summary: 'Stay in sync with your team via broadcasts and direct messages.',
    link: '/dashboard',
    linkLabel: 'Open Dashboard',
    color: '#f97316',
    steps: [
      'Click the bell icon at the bottom of the sidebar to open the Alerts & Messages panel.',
      'To broadcast to the whole team: type your message, leave "To: Everyone" selected, and send.',
      'For a direct message: click the "To: Everyone" dropdown and pick a specific teammate.',
      'Alerts (machine down, overdue WO) float to the top automatically with red/amber badges.',
      'Recipients see your message in real time -- no email or Slack needed for shift handoff.',
    ],
    tips: [
      'Use "Urgent" severity for critical issues -- it shows with a red badge and sounds an alert for receivers.',
      'Direct messages are private -- only the sender and recipient can see them.',
    ],
  },
  {
    icon: <Users size={16} />,
    title: 'Team & Permissions',
    summary: 'Invite users, assign roles, and control what each role can see and do.',
    link: '/settings?tab=users',
    linkLabel: 'Open Team Settings',
    color: '#84cc16',
    steps: [
      'Settings → Users → "Invite User" to add a teammate by email.',
      'Assign one of five roles: Developer (full access), Manager, Supervisor, Operator, Viewer.',
      'Settings → Permissions lets you show or hide specific nav items per role.',
      'Viewers can see everything but can\'t create, edit, or delete anything.',
      'Operators can log completions and NCRs; Supervisors can also manage apps and stations.',
    ],
    tips: [
      'Most shop-floor workers should be Operator role -- they can use the portal and log issues.',
      'The Permissions tab lets you, for example, hide Planning from operators who don\'t need it.',
    ],
  },
];

function HelpModuleCard({ guide, isOpen, onToggle }: {
  guide: ModuleGuide; isOpen: boolean; onToggle: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white"
          style={{ backgroundColor: guide.color }}>
          {guide.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900">{guide.title}</div>
          <div className="text-xs text-gray-500 mt-0.5 truncate">{guide.summary}</div>
        </div>
        <ChevronDown size={15} className={`text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">How to use it</div>
            <ol className="space-y-1.5">
              {guide.steps.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-700">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: guide.color }}>
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
          {guide.tips.length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 space-y-1">
              <div className="text-xs font-semibold text-amber-700">Pro tips</div>
              {guide.tips.map((t, i) => (
                <p key={i} className="text-xs text-amber-800 leading-relaxed">💡 {t}</p>
              ))}
            </div>
          )}
          <button
            onClick={() => navigate(guide.link)}
            className="text-sm font-semibold flex items-center gap-1.5 transition-colors"
            style={{ color: guide.color }}
          >
            {guide.linkLabel} <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function HelpTab() {
  const navigate = useNavigate();
  const [openGuide, setOpenGuide] = useState<string | null>(null);

  const replayTour = () => {
    localStorage.setItem(REPLAY_FLAG, '1');
    navigate('/dashboard');
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Product tour */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
            <PlayCircle size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900">Product tour</h3>
            <p className="text-sm text-gray-500 mt-1">
              New here, or want a refresher? Replay the 12-step guided walkthrough that introduces
              every area of the app.
            </p>
            <button onClick={replayTour} className="btn-primary mt-4">
              <PlayCircle size={15} /> Replay product tour
            </button>
          </div>
        </div>
      </div>

      {/* Per-module guides */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-1">Module guides</h3>
        <p className="text-sm text-gray-500 mb-4">
          Click any module for a step-by-step walkthrough and tips.
        </p>
        <div className="space-y-2">
          {MODULE_GUIDES.map(guide => (
            <HelpModuleCard
              key={guide.title}
              guide={guide}
              isOpen={openGuide === guide.title}
              onToggle={() => setOpenGuide(o => o === guide.title ? null : guide.title)}
            />
          ))}
        </div>
      </div>

      {/* Quick reference card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Quick reference</h3>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          {[
            ['Roles', 'Developer → Manager → Supervisor → Operator → Viewer'],
            ['Plan tiers', 'Free (5 apps) → Pro (unlimited + Inventory/Quality) → Enterprise (SSO + Facilities)'],
            ['Takt time', 'Target seconds per unit. Used to calculate OEE Performance score.'],
            ['OEE', 'Availability × Performance × Quality. World class = 85%+'],
            ['NCR', 'Non-Conformance Report -- a logged quality issue.'],
            ['App vs Work Order', 'An App is the instruction set; a Work Order is the job that runs it.'],
            ['Live Floor View', 'Live floor dashboard in the Command Center -- designed for a TV visible to the whole team.'],
            ['Direct message', 'Select a specific user in the message composer instead of "Everyone".'],
          ].map(([term, def]) => (
            <div key={term} className="py-2 border-b border-gray-50 last:border-0">
              <span className="text-xs font-semibold text-gray-700">{term}: </span>
              <span className="text-xs text-gray-500">{def}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'company', label: 'Company', icon: <Building2 size={15} /> },
  { id: 'plan', label: 'Plan & Billing', icon: <CreditCard size={15} /> },
  { id: 'theme', label: 'Visual Theme', icon: <Palette size={15} /> },
  { id: 'export', label: 'Data Export', icon: <Download size={15} /> },
];

export default function SettingsPage() {
  const { isAtLeast } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    const valid: TabId[] = ['account', 'company', 'plan', 'theme', 'sidebar', 'export', 'users', 'sites', 'notifications', 'developer', 'help'];
    return (tab && valid.includes(tab as TabId)) ? (tab as TabId) : 'account';
  });

  const ALL_TABS: { id: TabId; label: string; icon: React.ReactNode; minRole?: string }[] = [
    { id: 'account',  label: 'My Account',    icon: <Key size={15} /> },
    { id: 'company',  label: 'Company',        icon: <Building2 size={15} />,  minRole: 'manager' },
    { id: 'plan',     label: 'Plan & Billing', icon: <CreditCard size={15} />, minRole: 'manager' },
    { id: 'theme',    label: 'Visual Theme',   icon: <Palette size={15} /> },
    { id: 'sidebar',  label: 'Navigation',     icon: <PanelLeft size={15} /> },
    { id: 'export',   label: 'Data Export',    icon: <Download size={15} /> },
    { id: 'users',         label: 'Users & Access', icon: <Users size={15} />,   minRole: 'manager' },
    { id: 'sites',         label: 'Facility Setup', icon: <Network size={15} />,  minRole: 'manager' },
    { id: 'notifications', label: 'Notifications',  icon: <Bell size={15} />,     minRole: 'manager' },
    { id: 'developer',     label: 'Developer',      icon: <Code size={15} />,     minRole: 'manager' },
    { id: 'help',          label: 'Help & Guides',  icon: <HelpCircle size={15} /> },
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
          <p className="text-xs text-gray-500 mt-0.5">Manage your account, organization, and appearance</p>
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
        {activeTab === 'sidebar'  && <SidebarTab />}
        {activeTab === 'export'   && <ExportTab />}
        {activeTab === 'users'         && <><UsersTab /><div className="mt-8"><PermissionsTab /></div></>}
        {activeTab === 'sites'         && <SitesTab />}
        {activeTab === 'notifications' && <NotificationsTab />}
        {activeTab === 'developer'     && <DeveloperTab />}
        {activeTab === 'help'          && <HelpTab />}
      </div>
    </div>
  );
}

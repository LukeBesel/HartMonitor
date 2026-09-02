// ─── Company profile, branding, plant clock and the kiosk lock ──────────────
import { useState, useEffect, useRef } from 'react';
import { Settings, Check, AlertCircle, Key, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useBranding } from '../../context/BrandingContext';
import { api, browserTimeZone } from '../../api/client';
import { SectionHeader, Toast, timeZoneOptions, clockIn } from './shared';

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
  // Not a guess about which hemisphere the customer is in — the zone this
  // browser is actually set to, falling back to UTC when it will not say. This
  // is only the value shown before the server's own answer arrives.
  timezone: browserTimeZone() || 'UTC',
  date_format: 'MM/DD/YYYY',
  currency: 'USD',
  fiscal_year_start: 'January',
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];


// ─── Tab 1: Company ───────────────────────────────────────────────────────────

// ─── Kiosk lock — confine operator accounts to the shop-floor views ───────────
// Saves immediately (own toggle, separate from the company form's save button).
function KioskLockCard({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getCompanySettings()
      .then((data: Record<string, string>) => setLocked(data.operator_kiosk_lock === 'true'))
      .catch(() => {});
  }, []);

  const toggle = async () => {
    const next = !locked;
    setLocked(next); setBusy(true);
    try {
      await api.updateCompanySettings({ operator_kiosk_lock: String(next) });
      showToast(next
        ? 'Kiosk lock ON — operators are now confined to the Operator Portal and App Player.'
        : 'Kiosk lock OFF — operators can move between the shop floor and dashboards.');
    } catch (err: any) {
      setLocked(!next);
      showToast(err?.message || 'Could not update the kiosk lock', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-5 border border-gray-200 rounded-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">Lock operators to the shop floor</p>
          <p className="text-xs text-gray-500 mt-1 max-w-xl">
            When on, operator-role accounts only see the Operator Portal and App Player — no dashboards,
            analytics, or settings. Supervisors and above are never locked. Applies at next page load.
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={busy}
          role="switch"
          aria-checked={locked}
          className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${locked ? 'bg-blue-600' : 'bg-gray-300'} ${busy ? 'opacity-60' : ''}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${locked ? 'translate-x-5' : ''}`} />
        </button>
      </div>
    </div>
  );
}

export function CompanyTab() {
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
          <div className="field-row gap-4">
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
        <div className="field-row gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Timezone</label>
            <select className="input-field w-full" value={form.timezone} onChange={set('timezone')}>
              {timeZoneOptions(form.timezone).map(tz => (
                <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
              ))}
            </select>
            {/* This one setting decides when every "completed today" counter in
                the product rolls over, so the screen says so and shows the clock
                it is claiming. A wrong zone is otherwise invisible until a
                shift's output lands on the wrong day. */}
            <p className="mt-1 text-xs text-gray-500">
              {clockIn(form.timezone)
                ? <>It is <span className="font-medium text-gray-700">{clockIn(form.timezone)}</span> there now — every “today” count rolls over at midnight on this clock.</>
                : <>Every “today” count rolls over at midnight on this clock.</>}
            </p>
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

      {/* Shop-floor kiosk lock */}
      <KioskLockCard showToast={showToast} />

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

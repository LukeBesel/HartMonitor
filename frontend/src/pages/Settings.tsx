import { useState } from 'react';
import { Settings, Palette, Monitor, Info, Check } from 'lucide-react';
import { useTheme, THEME_PRESETS, Theme } from '../context/ThemeContext';

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

const SIDEBAR_OPTIONS = [
  { label: 'Navy', value: 'navy', bg: '#0a1628' },
  { label: 'Slate', value: 'slate', bg: '#0f172a' },
  { label: 'Charcoal', value: 'charcoal', bg: '#18181b' },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-blue-600' : 'bg-gray-200'
      }`}
      style={checked ? { backgroundColor: 'var(--accent)' } : {}}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();

  const [sidebarStyle, setSidebarStyle] = useState<string>('navy');
  const [showTakt, setShowTakt] = useState(() => {
    try { return localStorage.getItem('hm_show_takt') !== 'false'; } catch { return true; }
  });
  const [autoRefresh, setAutoRefresh] = useState(() => {
    try { return localStorage.getItem('hm_autorefresh') === 'true'; } catch { return false; }
  });
  const [compactNav, setCompactNav] = useState(() => {
    try { return localStorage.getItem('hm_compact_nav') === 'true'; } catch { return false; }
  });

  const handleThemeSelect = (preset: Theme) => {
    setTheme(preset);
  };

  const handleAutoRefreshToggle = (v: boolean) => {
    setAutoRefresh(v);
    try { localStorage.setItem('hm_autorefresh', String(v)); } catch { /* ignore */ }
  };

  const handleShowTaktToggle = (v: boolean) => {
    setShowTakt(v);
    try { localStorage.setItem('hm_show_takt', String(v)); } catch { /* ignore */ }
  };

  const handleCompactNavToggle = (v: boolean) => {
    setCompactNav(v);
    try { localStorage.setItem('hm_compact_nav', String(v)); } catch { /* ignore */ }
  };

  return (
    <div className="p-6 max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Customize your HartMonitor experience</p>
      </div>

      {/* Visual Theme */}
      <section className="card p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
            <Palette size={16} className="text-purple-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">Visual Theme</h2>
            <p className="text-xs text-gray-500">Choose an accent color preset</p>
          </div>
        </div>

        {/* Color swatch grid 4×2 */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {THEME_PRESETS.map((preset) => {
            const isSelected = theme.name === preset.name;
            return (
              <button
                key={preset.name}
                onClick={() => handleThemeSelect(preset)}
                className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                  isSelected
                    ? 'border-current shadow-md'
                    : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'
                }`}
                style={isSelected ? { borderColor: preset.accent } : {}}
              >
                <div
                  className="w-8 h-8 rounded-full shadow-sm flex items-center justify-center"
                  style={{ backgroundColor: preset.accent }}
                >
                  {isSelected && <Check size={14} className="text-white" strokeWidth={3} />}
                </div>
                <span className="text-[11px] font-medium text-gray-600 capitalize">{PRESET_LABELS[preset.name]}</span>
              </button>
            );
          })}
        </div>

        {/* Live preview */}
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500">Preview</div>
          <div className="p-4 flex items-center gap-3">
            <button
              className="px-4 py-2 rounded-lg text-white text-sm font-medium shadow-sm"
              style={{ backgroundColor: theme.accent }}
            >
              Primary Action
            </button>
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
            <div
              className="px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{ backgroundColor: theme.accentLight, color: theme.accentDark }}
            >
              Badge
            </div>
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: theme.accent }}
            />
            <span className="text-sm font-medium" style={{ color: theme.accent }}>
              {PRESET_LABELS[theme.name]}
            </span>
          </div>
        </div>
      </section>

      {/* Sidebar Style */}
      <section className="card p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <Monitor size={16} className="text-blue-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">Sidebar Style</h2>
            <p className="text-xs text-gray-500">Choose a sidebar background color</p>
          </div>
        </div>

        <div className="flex gap-3">
          {SIDEBAR_OPTIONS.map((opt) => {
            const isSelected = sidebarStyle === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setSidebarStyle(opt.value)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
                  isSelected ? 'border-blue-500 shadow-sm' : 'border-gray-100 hover:border-gray-200'
                }`}
                style={isSelected ? { borderColor: theme.accent } : {}}
              >
                <div
                  className="w-7 h-10 rounded-lg shadow-sm flex-shrink-0 flex items-end pb-1 justify-center"
                  style={{ backgroundColor: opt.bg }}
                >
                  {isSelected && (
                    <div className="w-3 h-0.5 rounded-full bg-white/60" />
                  )}
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-gray-800">{opt.label}</div>
                  <div className="text-xs text-gray-400 font-mono">{opt.bg}</div>
                </div>
                {isSelected && (
                  <Check size={14} className="ml-1" style={{ color: theme.accent }} />
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Display Preferences */}
      <section className="card p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
            <Settings size={16} className="text-green-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">Display Preferences</h2>
            <p className="text-xs text-gray-500">Configure interface behavior</p>
          </div>
        </div>

        <div className="space-y-1 divide-y divide-gray-50">
          <PreferenceRow
            label="Show takt time indicators in step list"
            description="Highlight steps that exceed takt time with visual warnings"
            checked={showTakt}
            onChange={handleShowTaktToggle}
          />
          <PreferenceRow
            label="Auto-refresh Manager View every 15s"
            description="Automatically reload manager view data in the background"
            checked={autoRefresh}
            onChange={handleAutoRefreshToggle}
          />
          <PreferenceRow
            label="Compact navigation labels"
            description="Show shorter labels in the sidebar to save space"
            checked={compactNav}
            onChange={handleCompactNavToggle}
          />
        </div>
      </section>

      {/* About */}
      <section className="card p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
            <Info size={16} className="text-gray-500" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">About</h2>
            <p className="text-xs text-gray-500">Application information</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 text-white">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
              style={{ background: `linear-gradient(135deg, ${theme.accent}, ${theme.accentDark})` }}
            >
              <Settings size={18} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-base">HartMonitor</div>
              <div className="text-xs text-slate-400">Manufacturing Intelligence Platform</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InfoRow label="Version" value="1.0.0" />
            <InfoRow label="Build" value="2025-06-05" />
            <InfoRow label="License" value="Commercial" />
            <InfoRow label="Theme" value={PRESET_LABELS[theme.name] || theme.name} />
          </div>
        </div>
      </section>
    </div>
  );
}

function PreferenceRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{description}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-semibold text-gray-800">{value}</span>
    </div>
  );
}

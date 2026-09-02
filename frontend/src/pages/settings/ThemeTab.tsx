// ─── Visual theme — per person, per device ──────────────────────────────────
import Toggle from '../../components/shared/Toggle';
import { useMemo, useState } from 'react';
import { Check, AlertCircle, Key, Moon, Sun } from 'lucide-react';
import { useTheme, THEME_PRESETS, Theme, buildCustomTheme, applySecondary } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { deriveAccentTokens } from '../../utils/contrast';
import { SectionHeader } from './shared';

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

// ─── Tab 3: Visual Theme ──────────────────────────────────────────────────────

export function ThemeTab() {
  const { theme, setTheme, darkMode, setDarkMode } = useTheme();
  // The preview is captioned "How your colors look across UI elements", so it
  // has to show what the app actually renders. It used to paint `theme.accent`
  // raw, which is the colour the picker returned, not the contrast-safe family
  // the app derives from it — so the panel showed white-on-pink at 3.53:1 that
  // no screen in the product has, and for a light hand-typed hex it went as low
  // as 1.19:1. Same derivation as the live app, same theme.
  const preview = useMemo(() => deriveAccentTokens(theme.accent, darkMode), [theme.accent, darkMode]);
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
              className="px-4 py-2 rounded-lg text-sm font-medium shadow-sm"
              style={{ backgroundColor: preview.accent, color: preview.accentFg }}
            >
              Primary Action
            </button>

            {/* Secondary button */}
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium border"
              style={{
                color: preview.accentInk,
                borderColor: preview.accent,
                backgroundColor: theme.accentLight,
              }}
            >
              Secondary
            </button>

            {/* Badge */}
            <div
              className="px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{ backgroundColor: theme.accentLight, color: preview.accentInk }}
            >
              Active
            </div>

            {/* Nav item simulation */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium"
              style={{ backgroundColor: theme.accentLight, color: preview.accentInk }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: preview.accentGlow }} />
              Nav Item
            </div>

            {/* Link */}
            <span className="text-sm font-medium" style={{ color: preview.accentInk }}>
              Hyperlink →
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

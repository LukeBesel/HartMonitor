import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export interface OverviewItem {
  icon: React.ElementType;
  label: string;
  desc: string;
}

interface ModuleOnboardingProps {
  moduleId: string;
  title: string;
  description: string;
  steps: string[];
  icon: React.ElementType;
  color: string;
  /** Optional system-wide overview. When provided, a "Tour the whole system"
   *  section of module tiles renders below the steps — used on the Dashboard so
   *  the first thing a new user sees explains the entire app, not just one page. */
  overview?: OverviewItem[];
  /** Optional intro line shown above the overview tiles. */
  overviewTitle?: string;
}

const STORAGE_PREFIX = 'hm_onboarding_seen_';

export default function ModuleOnboarding({
  moduleId,
  title,
  description,
  steps,
  icon: Icon,
  color,
  overview,
  overviewTitle = 'Tour the whole system',
}: ModuleOnboardingProps) {
  const storageKey = STORAGE_PREFIX + moduleId;
  const [visible, setVisible] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(storageKey);
    if (!seen) setVisible(true);
  }, [storageKey]);

  const dismiss = () => {
    localStorage.setItem(storageKey, '1');
    setVisible(false);
  };

  if (!visible) return null;

  const hasOverview = !!overview && overview.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${hasOverview ? 'max-w-2xl' : 'max-w-[480px]'} max-h-[90vh] overflow-y-auto`}>
        {/* Gradient header */}
        <div
          className="relative px-7 pt-8 pb-7 flex flex-col items-center text-center"
          style={{ background: `linear-gradient(135deg, ${color}22 0%, ${color}44 100%)` }}
        >
          <button
            onClick={dismiss}
            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
            style={{ backgroundColor: color }}
          >
            <Icon size={28} className="text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">{title}</h2>
          <p className="text-sm text-gray-600 leading-relaxed max-w-[440px]">{description}</p>
        </div>

        {/* Steps */}
        <div className="px-7 py-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Getting started
          </p>
          <ol className="space-y-2.5">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5"
                  style={{ backgroundColor: color }}
                >
                  {i + 1}
                </span>
                <span className="text-sm text-gray-700 leading-snug">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* System overview (Dashboard only) */}
        {hasOverview && (
          <div className="px-7 pb-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              {overviewTitle}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {overview!.map(({ icon: ItemIcon, label, desc }) => (
                <div key={label} className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50/60">
                  <div
                    className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${color}1a`, color }}
                  >
                    <ItemIcon size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800 leading-tight">{label}</div>
                    <div className="text-xs text-gray-500 leading-snug mt-0.5">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-7 pt-4 pb-6 flex flex-col gap-3">
          <button
            onClick={dismiss}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: color }}
          >
            Got it, let's go!
          </button>
          <label className="flex items-center justify-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors cursor-pointer select-none">
            <input
              type="checkbox"
              checked={checked}
              onChange={e => {
                setChecked(e.target.checked);
                if (e.target.checked) dismiss();
              }}
              className="rounded border-gray-300 text-gray-600 focus:ring-0"
            />
            Don't show again
          </label>
        </div>
      </div>
    </div>
  );
}

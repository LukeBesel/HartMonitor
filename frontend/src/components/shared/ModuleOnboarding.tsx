import { useState, useEffect } from 'react';
import { X, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { getWalkthrough, WalkthroughStep } from '../../config/walkthroughs';
import { LIGHT_GROUND, readableInk, shiftUntilReadable } from '../../utils/contrast';

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

/** Whether the walkthrough for a module has already been dismissed. */
export function hasSeenWalkthrough(moduleId: string): boolean {
  try {
    return !!localStorage.getItem(STORAGE_PREFIX + moduleId);
  } catch {
    return false;
  }
}

/** Mark a walkthrough as seen without showing it — used when another intro
 *  (e.g. the first-run setup wizard) supersedes it so tours never stack. */
export function markWalkthroughSeen(moduleId: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + moduleId, '1');
  } catch {
    /* ignore */
  }
}

/** Clear the "seen" flag so a walkthrough auto-shows again. Optional helper. */
export function resetWalkthrough(moduleId: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + moduleId);
  } catch {
    /* ignore */
  }
}

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

  useEffect(() => {
    const seen = localStorage.getItem(storageKey);
    if (!seen) setVisible(true);
  }, [storageKey]);

  const dismiss = () => {
    localStorage.setItem(storageKey, '1');
    setVisible(false);
  };

  if (!visible) return null;

  const walkthrough = getWalkthrough(moduleId);

  if (walkthrough && walkthrough.length > 0) {
    return (
      <PagedWalkthrough
        title={title}
        color={color}
        moduleIcon={Icon}
        steps={walkthrough}
        overview={overview}
        overviewTitle={overviewTitle}
        onDismiss={dismiss}
      />
    );
  }

  // ───────────────── Legacy single-card fallback (backward compatible) ───────
  return (
    <LegacyCard
      title={title}
      description={description}
      steps={steps}
      Icon={Icon}
      color={color}
      overview={overview}
      overviewTitle={overviewTitle}
      onDismiss={dismiss}
    />
  );
}

/* ───────────────────────────── Paged walkthrough ──────────────────────────── */

interface PagedProps {
  title: string;
  color: string;
  moduleIcon: React.ElementType;
  steps: WalkthroughStep[];
  overview?: OverviewItem[];
  overviewTitle: string;
  onDismiss: () => void;
}

function PagedWalkthrough({
  title,
  color,
  moduleIcon: ModuleIcon,
  steps,
  overview,
  overviewTitle,
  onDismiss,
}: PagedProps) {
  const hasOverview = !!overview && overview.length > 0;
  // The overview tiles (Dashboard) become a final "explore the system" page.
  const total = steps.length + (hasOverview ? 1 : 0);
  const [index, setIndex] = useState(0);

  const isOverviewPage = hasOverview && index === total - 1;
  const isLast = index === total - 1;
  const step = isOverviewPage ? undefined : steps[index];

  const StepIcon = step?.icon ?? ModuleIcon;

  const goNext = () => {
    if (isLast) onDismiss();
    else setIndex(i => Math.min(i + 1, total - 1));
  };
  const goBack = () => setIndex(i => Math.max(i - 1, 0));

  return (
    <Backdrop>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto flex flex-col">
        {/* Gradient header */}
        <div
          className="relative px-7 pt-6 pb-5 flex items-center gap-3"
          style={{ background: `linear-gradient(135deg, ${color}22 0%, ${color}44 100%)` }}
        >
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center shadow-md flex-shrink-0"
            style={{ backgroundColor: color, color: readableInk(color) }}
          >
            <ModuleIcon size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Guided tour
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-tight truncate">{title}</h2>
          </div>
          <button
            onClick={onDismiss}
            aria-label="Close walkthrough"
            className="absolute top-1.5 right-1.5 w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-black/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Progress */}
        <div className="px-7 pt-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                aria-label={`Go to step ${i + 1}`}
                className="h-6 min-w-[24px] flex items-center justify-center"
              >
                <span
                  className="h-1.5 rounded-full transition-all block"
                  style={{
                    width: i === index ? 24 : 8,
                    backgroundColor: i === index ? color : `${color}33`,
                  }}
                />
              </button>
            ))}
          </div>
          <span className="text-xs font-medium text-gray-400 whitespace-nowrap">
            Step {index + 1} of {total}
          </span>
        </div>

        {/* Body (keyed so transitions feel fresh between steps) */}
        <div key={index} className="px-7 py-5 flex-1 animate-[fadeIn_0.2s_ease]">
          {isOverviewPage ? (
            <OverviewPage overview={overview!} overviewTitle={overviewTitle} color={color} />
          ) : (
            <div>
              <div className="flex items-start gap-3 mb-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${color}1a`, color: shiftUntilReadable(color, LIGHT_GROUND) }}
                >
                  <StepIcon size={18} />
                </div>
                <h3 className="text-base font-bold text-gray-900 leading-snug pt-1">
                  {step!.title}
                </h3>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{step!.body}</p>
              {step!.bullets && step!.bullets.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {step!.bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span
                        className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm text-gray-700 leading-snug">{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Footer controls */}
        <div className="px-7 pb-6 pt-2 flex items-center justify-between gap-3">
          <button
            onClick={onDismiss}
            className="-mx-2 px-2 h-8 flex items-center rounded-lg text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-black/5 transition-colors"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={goBack}
              disabled={index === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ArrowLeft size={15} />
              Back
            </button>
            <button
              onClick={goNext}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: color, color: readableInk(color) }}
            >
              {isLast ? (
                <>
                  Finish
                  <Check size={15} />
                </>
              ) : (
                <>
                  Next
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

function OverviewPage({
  overview,
  overviewTitle,
  color,
}: {
  overview: OverviewItem[];
  overviewTitle: string;
  color: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        {overviewTitle}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {overview.map(({ icon: ItemIcon, label, desc }) => (
          <div
            key={label}
            className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50/60"
          >
            <div
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${color}1a`, color: shiftUntilReadable(color, LIGHT_GROUND) }}
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
  );
}

/* ───────────────────────────── Legacy single card ─────────────────────────── */

interface LegacyProps {
  title: string;
  description: string;
  steps: string[];
  Icon: React.ElementType;
  color: string;
  overview?: OverviewItem[];
  overviewTitle: string;
  onDismiss: () => void;
}

function LegacyCard({
  title,
  description,
  steps,
  Icon,
  color,
  overview,
  overviewTitle,
  onDismiss,
}: LegacyProps) {
  const [checked, setChecked] = useState(false);
  const hasOverview = !!overview && overview.length > 0;

  return (
    <Backdrop>
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full ${
          hasOverview ? 'max-w-2xl' : 'max-w-[480px]'
        } max-h-[90vh] overflow-y-auto`}
      >
        {/* Gradient header */}
        <div
          className="relative px-7 pt-8 pb-7 flex flex-col items-center text-center"
          style={{ background: `linear-gradient(135deg, ${color}22 0%, ${color}44 100%)` }}
        >
          <button
            onClick={onDismiss}
            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
            style={{ backgroundColor: color, color: readableInk(color) }}
          >
            <Icon size={28} />
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
                  className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                  style={{ backgroundColor: color, color: readableInk(color) }}
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
                <div
                  key={label}
                  className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50/60"
                >
                  <div
                    className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${color}1a`, color: shiftUntilReadable(color, LIGHT_GROUND) }}
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
            onClick={onDismiss}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-colors"
            style={{ backgroundColor: color, color: readableInk(color) }}
          >
            Got it, let's go!
          </button>
          <label className="flex items-center justify-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors cursor-pointer select-none">
            <input
              type="checkbox"
              checked={checked}
              onChange={e => {
                setChecked(e.target.checked);
                if (e.target.checked) onDismiss();
              }}
              className="rounded border-gray-300 text-gray-600 focus:ring-0"
            />
            Don't show again
          </label>
        </div>
      </div>
    </Backdrop>
  );
}

/* ─────────────────────────────────── Shared ───────────────────────────────── */

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6">
      {children}
    </div>
  );
}

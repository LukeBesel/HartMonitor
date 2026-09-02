import { useEffect, useState } from 'react';
import { X, ArrowLeft, ArrowRight, Check, Compass } from 'lucide-react';
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

/** Clear the "seen" flag. Nothing reads that flag to decide what to render any
 *  more — the button is always there and the tour opens on click — so this is a
 *  no-op as far as the UI is concerned, kept only so the module's exported API
 *  is unchanged for any caller that still calls it. */
export function resetWalkthrough(moduleId: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + moduleId);
  } catch {
    /* ignore */
  }
}

/**
 * A page's tour, and nothing else on first paint.
 *
 * This component used to open its walkthrough over the page the moment someone
 * arrived, because its localStorage key was absent — which is true of every
 * page on every account exactly once, so a first session meant a modal on nine
 * different screens. In an audit two clicks failed outright because one of
 * those overlays was in front of the thing being clicked.
 *
 * It now renders a small "Show me around" button instead. Same props, same call
 * signature (nine pages mount it and none of them changed), same seen-state
 * helpers — the only difference is that the tour waits to be asked. Pages whose
 * moduleId has no entry in WALKTHROUGHS render nothing at all: a button that
 * opens a tour of a screen we deleted is worse than no button.
 */
export default function ModuleOnboarding({
  moduleId,
  title,
  // `description` and `steps` stay in the props interface because nine pages
  // pass them and none of those pages may change; the walkthrough registry is
  // what the tour actually reads.
  icon: Icon,
  color,
  overview,
  overviewTitle = 'Tour the whole system',
}: ModuleOnboardingProps) {
  const storageKey = STORAGE_PREFIX + moduleId;
  const [open, setOpen] = useState(false);

  const walkthrough = getWalkthrough(moduleId);
  const hasTour = !!walkthrough && walkthrough.length > 0;

  // No content for this page — render nothing rather than a button that opens
  // an empty tour. (The legacy single-card fallback below still covers pages
  // that pass their own `steps` and DO have a walkthrough registered.)
  if (!hasTour) return null;

  const dismiss = () => {
    try { localStorage.setItem(storageKey, '1'); } catch { /* private mode */ }
    setOpen(false);
  };

  return (
    <>
      <ShowMeAroundButton title={title} color={color} onClick={() => setOpen(true)} />
      {open && (
        <PagedWalkthrough
          title={title}
          color={color}
          moduleIcon={Icon}
          steps={walkthrough!}
          overview={overview}
          overviewTitle={overviewTitle}
          onDismiss={dismiss}
        />
      )}
    </>
  );
}

/* ─────────────────────────── The one visible control ──────────────────────── */

/** Small, secondary, and quiet: it sits above the page heading on a 390px phone
 *  without pushing anything around, and it inherits the app's dark-mode
 *  retrofit (`.dark .bg-white`, `.dark .border-gray-200`, `.dark .text-gray-*`
 *  in index.css) rather than inventing its own palette. */
function ShowMeAroundButton({
  title, color, onClick,
}: { title: string; color: string; onClick: () => void }) {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onClick}
        aria-label={`Show me around ${title}`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
      >
        <Compass size={13} style={{ color }} aria-hidden />
        Show me around
      </button>
    </div>
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

  // Escape closes it. Someone who opened this by accident should not have to
  // hunt for the X, and a tour is the one thing on screen that nobody is
  // obliged to finish.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

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

/* The legacy single-card fallback lived here. It only ever rendered for a
 * moduleId with no entry in WALKTHROUGHS, and that case now renders nothing at
 * all, so the card was unreachable code describing pages we no longer tour. */

/* ─────────────────────────────────── Shared ───────────────────────────────── */

/** The tour is a real dialog, and says so. Declaring the role is what lets a
 *  test — and a screen reader — count how many guides are on screen at once;
 *  the answer for a new account is meant to be at most one.
 *
 *  Deliberately NOT aria-modal. That attribute tells assistive tech that
 *  everything behind this element is inert, and nothing here enforces that —
 *  there is no focus trap and the page behind stays reachable. Claiming it
 *  would be a promise to screen-reader users that the markup does not keep.
 *  Escape closes the tour (see PagedWalkthrough), which is the part that
 *  actually helps someone who opened it by accident. */
function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-label="Guided tour"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6"
    >
      {children}
    </div>
  );
}

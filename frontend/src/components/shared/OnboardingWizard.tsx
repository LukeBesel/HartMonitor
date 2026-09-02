import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Database, Users, CheckCircle2, RefreshCw, X, ArrowRight, ArrowLeft,
  Blocks, Tablet, BarChart3, Layers, Zap, Rocket,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { dismissTraining } from '../apps/useAppTraining';
import { useBranding, useCompanySetting } from '../../context/BrandingContext';

// Set by the "Replay product tour" button in Settings before navigating to the
// dashboard, so the wizard re-opens even though onboarding was completed.
export const REPLAY_FLAG = 'hm_replay_onboarding';

/** Fired the moment the welcome is finished or skipped. The builder-training
 *  coach waits for this so a brand-new manager never gets two tours at once. */
export const ONBOARDING_DONE_EVENT = 'hm:onboarding-finished';

function isTruthy(v: any): boolean {
  if (v === undefined || v === null) return false;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

type StepKind = 'intro' | 'tour' | 'start';
interface Step {
  kind: StepKind;
  icon: React.ElementType;
  title: string;
  body: string;
  bullets?: string[];
}

// The welcome is BUILDER-FIRST on purpose. HartMonitor's differentiator is the
// no-code app builder and the operator player it feeds, so the first thing a
// new customer is told is how that loop works — everything else in the MES is
// introduced as something that plugs into it. The wizard hands off to the
// guided training coach (AppTrainingCoach), which walks the loop for real.
const STEPS: Step[] = [
  {
    kind: 'intro',
    icon: Sparkles,
    title: 'Welcome to HartMonitor',
    body: 'HartMonitor starts with apps: guided procedures you build yourself and your operators run at their stations. Two minutes here and you will know exactly how that works.',
  },
  {
    kind: 'tour',
    icon: Blocks,
    title: 'The app builder',
    body: 'An app is a sequence of steps. Each step holds widgets — the things an operator reads, checks, photographs or types. You build it by dragging, not coding.',
    bullets: [
      'Steps are the screens an operator walks through, one at a time',
      'Widgets capture data: numbers, pass/fail, photos, scans, signatures',
      'Instructions, images, video and 3D models go on the same canvas',
    ],
  },
  {
    kind: 'tour',
    icon: Zap,
    title: 'Logic without code',
    body: 'Triggers are the "if this, then that" of your process, written in plain language: When a button is pressed → If the reading is out of spec → Then block with an error and raise an NCR.',
    bullets: [
      'When: a button press, a step opening, a value changing, a scan',
      'If: compare a captured value, a variable, or nothing at all',
      'Then: jump to a step, show a message, block, save a record, file an NCR',
    ],
  },
  {
    kind: 'tour',
    icon: Tablet,
    title: 'Operators run it',
    body: 'Publish, and the app is live on the floor. The player is a full-screen, tablet-first runtime — big targets, one clear next action, and a run in progress keeps going if the Wi-Fi drops.',
    bullets: [
      'Operators sign in with a badge or PIN and pick their job',
      'Takt countdowns, kit checks and photo evidence are built in',
      'A run already started keeps recording offline and syncs when you reconnect.',
    ],
  },
  {
    kind: 'tour',
    icon: BarChart3,
    title: 'The data comes back',
    body: 'Every value an operator enters is stored against that run. App analytics turns it into cycle times, pass rates and per-field trends you can export — and the rest of the MES reads the same runs.',
    bullets: [
      'Per-app analytics: runs, durations, first-pass yield, field-by-field stats',
      'Work orders, OEE, quality and the Command Center all read these runs',
      'Everything exports to CSV, nothing is locked in',
    ],
  },
  {
    kind: 'start',
    icon: Rocket,
    title: 'Build your first app',
    body: 'Start from a HartMonitor model template — a real, editable app — or from blank. A step-by-step coach will follow you through building, publishing and running it.',
  },
];

export default function OnboardingWizard({ onWillShow }: { onWillShow?: () => void } = {}) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [index, setIndex] = useState(0);

  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [sampleError, setSampleError] = useState('');

  // The completion flag rides along on the company settings the branding
  // provider already loaded — this used to be its own GET /api/config.
  const { value: completedFlag, status: settingsStatus } = useCompanySetting('onboarding_completed');
  const { refresh: refreshBranding } = useBranding();

  useEffect(() => {
    // Explicit replay from Settings bypasses the "completed" check.
    const replay = localStorage.getItem(REPLAY_FLAG);
    if (replay) {
      localStorage.removeItem(REPLAY_FLAG);
      setEligible(true);
      setReady(true);
      onWillShow?.();
      return;
    }
    if (settingsStatus === 'loading') return;
    // Couldn't read the flag, so we don't know whether this welcome has already
    // been dismissed — better to stay out of the way than to show it twice.
    if (settingsStatus === 'error') { setEligible(false); setReady(true); return; }
    const completed = isTruthy(completedFlag);
    const roleOk = user?.role === 'manager' || user?.role === 'developer';
    setEligible(!completed && roleOk);
    if (!completed && roleOk) onWillShow?.();
    setReady(true);
  }, [user?.role, settingsStatus, completedFlag]);

  const persistDone = () => {
    // Lets the builder-training coach know the welcome is out of the way, so
    // the two never stack on top of each other.
    try { window.dispatchEvent(new CustomEvent(ONBOARDING_DONE_EVENT)); } catch { /* ignore */ }
    return api.updateCompanySettings({ onboarding_completed: 'true' })
      // Everyone else reads this flag off the shared settings copy, so that copy
      // has to learn about the write.
      .then(() => refreshBranding())
      .catch(() => {});
  };

  const finish = async () => {
    await persistDone();
    setClosed(true);
  };

  /** "Skip tour" and the X mean "I don't want to be walked through this", so
   *  they stand the builder-training coach down too. Without this, closing the
   *  welcome popped a second guided panel open in its place, which reads as the
   *  app ignoring the answer. Reaching the END of the tour and choosing "Not
   *  now" is different — that hands off to the coach as intended. The sidebar
   *  setup checklist still appears either way, and Settings can restart the
   *  training. */
  const skip = async () => {
    dismissTraining(user?.id);
    await finish();
  };

  /** Primary hand-off: close the welcome and drop the user straight into
   *  creating their first app, where the training coach takes over. */
  const startBuilding = () => {
    persistDone();
    setClosed(true);
    navigate('/apps?new=1');
  };

  const handleLoadSampleData = async () => {
    setLoadingSample(true);
    setSampleError('');
    try {
      await api.loadSampleData();
      setSampleLoaded(true);
    } catch (err: any) {
      setSampleError(err?.message || 'Failed to load sample data');
    } finally {
      setLoadingSample(false);
    }
  };

  const goToUsers = () => {
    persistDone();
    setClosed(true);
    navigate('/settings?tab=users');
  };

  if (!ready || closed || !eligible) return null;

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;
  const next = () => setIndex(i => Math.min(STEPS.length - 1, i + 1));
  const back = () => setIndex(i => Math.max(0, i - 1));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to HartMonitor"
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5">
          <div className="text-xs font-medium text-gray-400">Step {index + 1} of {STEPS.length}</div>
          <button
            onClick={skip}
            title="Skip tour"
            aria-label="Skip tour"
            className="-mr-1.5 w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-black/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Progress dots */}
        <div className="flex items-center gap-1 px-6 pt-2">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className="h-1.5 flex-1 rounded-full transition-colors"
              style={{ background: i <= index ? 'linear-gradient(135deg, var(--accent), var(--secondary))' : '#e5e7eb' }}
            />
          ))}
        </div>

        <div className="px-6 py-6 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}
          >
            <step.icon size={26} />
          </div>
          <h2 className="text-lg font-bold text-gray-900">{step.title}</h2>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">{step.body}</p>

          {step.bullets && (
            <ul className="mt-4 space-y-2 text-left max-w-sm mx-auto">
              {step.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--accent)' }} />
                  <span className="text-sm text-gray-600 leading-snug">{b}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Final page: hand off to the builder, with the other first-day
              actions available but secondary. */}
          {step.kind === 'start' && (
            <div className="mt-5 space-y-3">
              <button onClick={startBuilding} className="btn-primary w-full justify-center">
                <Layers size={15} /> Build my first app
              </button>
              {sampleError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{sampleError}</p>}
              <div className="flex flex-col sm:flex-row gap-2">
                {sampleLoaded ? (
                  <div className="flex-1 flex items-center justify-center gap-2 text-green-600 text-sm font-medium py-2">
                    <CheckCircle2 size={16} /> Sample data loaded
                  </div>
                ) : (
                  <button onClick={handleLoadSampleData} disabled={loadingSample} className="btn-secondary flex-1 justify-center">
                    {loadingSample ? <><RefreshCw size={14} className="animate-spin" /> Loading…</> : <><Database size={14} /> Load sample data</>}
                  </button>
                )}
                <button onClick={goToUsers} className="btn-secondary flex-1 justify-center">
                  <Users size={14} /> Invite my team
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between px-6 pb-5">
          <button
            onClick={back}
            disabled={index === 0}
            className="-ml-2 px-2 h-8 flex items-center gap-1 rounded-lg text-sm text-gray-500 hover:text-gray-800 hover:bg-black/5 disabled:opacity-0 transition-colors"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <button onClick={skip} className="px-2 h-8 flex items-center rounded-lg text-xs text-gray-500 hover:text-gray-800 hover:bg-black/5 transition-colors">Skip tour</button>
          {isLast ? (
            <button onClick={finish} className="btn-secondary text-sm">Not now</button>
          ) : (
            <button onClick={next} className="btn-primary text-sm">Next <ArrowRight size={14} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

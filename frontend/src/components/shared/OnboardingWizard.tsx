import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Database, Users, CheckCircle2, RefreshCw, X, ArrowRight, ArrowLeft,
  LayoutDashboard, Tablet, AppWindow, Monitor, CalendarRange, BarChart3,
  ShieldCheck, Bell,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

// Set by the "Replay product tour" button in Settings before navigating to the
// dashboard, so the wizard re-opens even though onboarding was completed.
export const REPLAY_FLAG = 'hm_replay_onboarding';

function isTruthy(v: any): boolean {
  if (v === undefined || v === null) return false;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

type StepKind = 'intro' | 'sample' | 'invite' | 'tour' | 'finish';
interface Step {
  kind: StepKind;
  icon: React.ElementType;
  title: string;
  body: string;
}

// A guided walkthrough that introduces every major area of the app. Informational
// "tour" steps just explain a section; the sample-data and invite steps are
// interactive. Replayable anytime from Settings.
const STEPS: Step[] = [
  { kind: 'intro',  icon: Sparkles,        title: 'Welcome to your MES',        body: "This is your command center for running the shop floor — apps, work orders, stations, quality, and analytics, all in one place. Here's a quick tour of how it fits together." },
  { kind: 'sample', icon: Database,        title: 'Load sample data',           body: 'Populate your workspace with example apps, work orders, stations, and inventory so you can explore right away. You can clear it anytime.' },
  { kind: 'tour',   icon: LayoutDashboard, title: 'Command Center',             body: 'Your home dashboard. It surfaces what needs attention — overdue work orders, quality flags, and today’s output — so you always know where to look first.' },
  { kind: 'tour',   icon: Tablet,          title: 'Operator Portal',            body: 'The shop-floor screen your operators use. They pick their name, choose a job and part, and start working — no menus or settings to get lost in. Open it anytime from the blue "Operator Portal" button in the sidebar.' },
  { kind: 'tour',   icon: AppWindow,       title: 'App Library & Builder',      body: 'Build step-by-step digital work instructions with the drag-and-drop App Builder, then publish them. Operators run these guided apps at their stations.' },
  { kind: 'tour',   icon: Monitor,         title: 'Stations & Plant View',      body: 'Define your physical work centers, assign apps to them, and watch live status across the floor in Plant View.' },
  { kind: 'tour',   icon: CalendarRange,   title: 'Planning',                   body: 'Schedule work orders, balance capacity, and (on paid plans) manage inventory and purchasing. This whole section unlocks as your operation grows.' },
  { kind: 'tour',   icon: BarChart3,       title: 'Reporting & Analytics',      body: 'Track throughput, cycle times, OEE, and a live leaderboard. Build custom dashboards to watch the numbers that matter to you.' },
  { kind: 'tour',   icon: ShieldCheck,     title: 'Quality & NCR',              body: 'Capture pass/fail at each step and log non-conformance reports. Operators can even report issues straight from the portal.' },
  { kind: 'tour',   icon: Bell,            title: 'Alerts & Messages',          body: 'The bell at the bottom-left combines what needs attention with team messages. You can broadcast to everyone or send a direct message to one teammate.' },
  { kind: 'invite', icon: Users,           title: 'Invite your team',           body: 'Bring operators, supervisors, and managers on board so everyone collaborates from day one. You control who can see and do what with roles.' },
  { kind: 'finish', icon: CheckCircle2,    title: "You're all set!",            body: 'That’s the whole tour. You can replay it anytime from Settings → Help & Guides. Now go build something.' },
];

export default function OnboardingWizard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [index, setIndex] = useState(0);

  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [sampleError, setSampleError] = useState('');

  useEffect(() => {
    // Explicit replay from Settings bypasses the "completed" check.
    const replay = localStorage.getItem(REPLAY_FLAG);
    if (replay) {
      localStorage.removeItem(REPLAY_FLAG);
      setEligible(true);
      setReady(true);
      return;
    }
    let cancelled = false;
    api.getCompanySettings()
      .then(settings => {
        if (cancelled) return;
        const completed = isTruthy(settings?.onboarding_completed);
        const roleOk = user?.role === 'manager' || user?.role === 'developer';
        setEligible(!completed && roleOk);
      })
      .catch(() => setEligible(false))
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [user?.role]);

  const finish = async () => {
    try {
      await api.updateCompanySettings({ onboarding_completed: 'true' });
    } catch {
      // Even if persisting fails, don't block the user from dismissing.
    } finally {
      setClosed(true);
    }
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
    api.updateCompanySettings({ onboarding_completed: 'true' }).catch(() => {});
    setClosed(true);
    navigate('/settings?tab=users');
  };

  if (!ready || closed || !eligible) return null;

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;
  const next = () => setIndex(i => Math.min(STEPS.length - 1, i + 1));
  const back = () => setIndex(i => Math.max(0, i - 1));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5">
          <div className="text-xs font-medium text-gray-400">Step {index + 1} of {STEPS.length}</div>
          <button onClick={finish} className="text-gray-400 hover:text-gray-600" title="Skip tour">
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
          <p className="text-sm text-gray-500 mt-2">{step.body}</p>

          {/* Sample-data action */}
          {step.kind === 'sample' && (
            <div className="mt-5">
              {sampleError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{sampleError}</p>}
              {sampleLoaded ? (
                <div className="flex items-center justify-center gap-2 text-green-600 text-sm font-medium">
                  <CheckCircle2 size={16} /> Sample data loaded!
                </div>
              ) : (
                <button onClick={handleLoadSampleData} disabled={loadingSample} className="btn-primary w-full justify-center">
                  {loadingSample ? <><RefreshCw size={14} className="animate-spin" /> Loading…</> : 'Load Sample Data'}
                </button>
              )}
            </div>
          )}

          {/* Invite action */}
          {step.kind === 'invite' && (
            <div className="mt-5">
              <button onClick={goToUsers} className="btn-primary w-full justify-center">
                Invite Team Members <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between px-6 pb-5">
          <button
            onClick={back}
            disabled={index === 0}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 disabled:opacity-0 transition-colors"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <button onClick={finish} className="text-xs text-gray-400 hover:text-gray-600">Skip tour</button>
          {isLast ? (
            <button onClick={finish} className="btn-primary text-sm">Finish</button>
          ) : (
            <button onClick={next} className="btn-primary text-sm">Next <ArrowRight size={14} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

// The builder-first guided training, rendered as a persistent coach that
// follows the user through the real product instead of a modal that explains
// it. Mounted once from App.tsx; it decides for itself when to appear.
//
// Every milestone is derived from real account data (see useAppTraining), so
// the only way to advance is to actually build, publish and run an app.

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Check, ChevronDown, ChevronUp, X, ArrowRight, GraduationCap,
  Sparkles, RefreshCw, PartyPopper,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useModules } from '../../context/ModulesContext';
import { ONBOARDING_DONE_EVENT } from '../shared/OnboardingWizard';
import { useAppTraining, TrainingStepId } from './useAppTraining';

/** Routes where the coach belongs: the apps surfaces plus the screens the
 *  training sends people back to. Deliberately NOT the operator player —
 *  nothing overlays the runtime an operator is working in. */
function coachAllowedOn(pathname: string): boolean {
  if (pathname.startsWith('/play')) return false;
  return (
    pathname === '/dashboard'
    || pathname === '/apps'
    || pathname.startsWith('/apps/')
    || pathname.startsWith('/completions/')
  );
}

/** The builder is a dense four-region workspace and the coach points AT parts
 *  of it (the widget palette, the Triggers tab), so there it starts as the
 *  small pill rather than a panel sitting on top of the thing being taught. */
function isBuilderRoute(pathname: string): boolean {
  return /^\/apps\/[^/]+\/build/.test(pathname);
}

// ── Dock signal ──────────────────────────────────────────────────────────────
// The coach floats over the page, so the apps pages need to know when to leave
// a gutter for it instead of hiding a column underneath. Kept as a module-level
// value plus an event so any page can subscribe without prop-drilling.

const DOCK_EVENT = 'hm:coach-docked';
let coachDocked = false;

function setCoachDocked(next: boolean): void {
  if (coachDocked === next) return;
  coachDocked = next;
  try { window.dispatchEvent(new CustomEvent(DOCK_EVENT, { detail: next })); } catch { /* ignore */ }
}

/** True while the expanded training panel is on screen. Pages use it to reserve
 *  a right-hand gutter so nothing important sits underneath. */
export function useCoachDocked(): boolean {
  const [docked, setDocked] = useState(coachDocked);
  useEffect(() => {
    const handler = (e: Event) => setDocked(!!(e as CustomEvent).detail);
    window.addEventListener(DOCK_EVENT, handler);
    setDocked(coachDocked);
    return () => window.removeEventListener(DOCK_EVENT, handler);
  }, []);
  return docked;
}

export default function AppTrainingCoach() {
  const { user, canEdit } = useAuth();
  const { isEnabled } = useModules();
  const location = useLocation();
  const navigate = useNavigate();
  // Only check progress on the screens that can actually show the coach.
  const trainingEnabled = !!user && canEdit && isEnabled('apps') && coachAllowedOn(location.pathname);
  const training = useAppTraining(user?.id, location.pathname, trainingEnabled);
  const [justFinished, setJustFinished] = useState(false);
  const [manuallyOpened, setManuallyOpened] = useState(false);
  const isNarrow = useIsNarrow();
  const welcomeDone = useWelcomeDone(user?.role);

  // Celebrate once when the last milestone lands, then let the user close it.
  useEffect(() => {
    if (training.complete && !training.dismissed) setJustFinished(true);
  }, [training.complete, training.dismissed]);

  // Moving to another screen resets the "I opened it anyway" override.
  useEffect(() => { setManuallyOpened(false); }, [location.pathname]);

  const visible =
    !!user && canEdit && isEnabled('apps') && welcomeDone
    && !training.dismissed
    && coachAllowedOn(location.pathname)
    && !(training.loading && training.doneCount === 0)
    && (!training.complete || justFinished);

  // Starts as the pill wherever a panel would be in the way: the builder (the
  // coach points AT its regions) and anything narrower than a desktop.
  const wantsPill = isBuilderRoute(location.pathname) || isNarrow;
  const showAsPill =
    visible && !training.complete
    && (training.collapsed || (wantsPill && !manuallyOpened));

  // Only the expanded panel needs a gutter; the pill is small enough to float.
  useEffect(() => {
    setCoachDocked(visible && !showAsPill);
    return () => setCoachDocked(false);
  }, [visible, showAsPill]);

  if (!visible) return null;

  const { milestones, doneCount, total, activeIndex, targetApp, runnableApp } = training;
  const active = activeIndex >= 0 ? milestones[activeIndex] : null;
  const pct = Math.round((doneCount / total) * 100);

  const go = (id: TrainingStepId) => {
    switch (id) {
      case 'create':
        navigate('/apps?new=1');
        break;
      case 'run':
        if (runnableApp) navigate(`/play/${runnableApp.id}`);
        else if (targetApp) navigate(`/apps/${targetApp.id}/build`);
        else navigate('/apps?new=1');
        break;
      case 'data':
        if (targetApp) navigate(`/apps/${targetApp.id}/analytics`);
        else navigate('/apps');
        break;
      default:
        if (targetApp) navigate(`/apps/${targetApp.id}/build`);
        else navigate('/apps?new=1');
    }
  };

  // ── Collapsed pill ──
  if (showAsPill) {
    return (
      <button
        onClick={() => { training.setCollapsed(false); setManuallyOpened(true); }}
        className="fixed bottom-4 right-4 z-[45] flex items-center gap-2.5 rounded-full bg-gray-900 text-white pl-3 pr-4 py-2.5 shadow-xl hover:bg-gray-800 transition-colors"
      >
        <span className="relative flex items-center justify-center w-7 h-7">
          <svg viewBox="0 0 36 36" className="w-7 h-7 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="4" />
            <circle
              cx="18" cy="18" r="15" fill="none" stroke="var(--accent)" strokeWidth="4"
              strokeDasharray={`${(pct / 100) * 94.2} 94.2`} strokeLinecap="round"
            />
          </svg>
          <GraduationCap size={13} className="absolute" />
        </span>
        <span className="text-left leading-tight">
          <span className="block text-[13px] font-semibold">Build your first app</span>
          <span className="block text-[11px] text-gray-400">{doneCount} of {total} done</span>
        </span>
        <ChevronUp size={15} className="text-gray-400" />
      </button>
    );
  }

  // ── Completed celebration ──
  if (training.complete) {
    return (
      <Shell>
        <div className="p-5 text-center">
          <div className="w-11 h-11 rounded-2xl bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-3">
            <PartyPopper size={22} />
          </div>
          <h3 className="text-[15px] font-bold text-gray-900">You built and ran an app</h3>
          <p className="text-[13px] text-gray-500 mt-1.5 leading-relaxed">
            That is the whole loop: build it, publish it, your floor runs it, the data lands back here.
            Everything else in HartMonitor plugs into these runs.
          </p>
          <div className="flex gap-2 mt-4">
            <button onClick={() => { setJustFinished(false); training.dismiss(); }} className="btn-secondary flex-1 justify-center">
              Close
            </button>
            <button onClick={() => { setJustFinished(false); training.dismiss(); navigate('/apps'); }} className="btn-primary flex-1 justify-center">
              Build another <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Expanded coach ──
  return (
    <Shell>
      {/* Header */}
      <div className="flex items-start gap-2.5 px-4 pt-3.5 pb-3 border-b border-gray-100">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}
        >
          <GraduationCap size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Guided training</div>
          <h3 className="text-[14px] font-bold text-gray-900 leading-tight">Build your first app</h3>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={training.refresh}
            title="Re-check my progress"
            aria-label="Re-check my progress"
            className="p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100"
          >
            <RefreshCw size={13} className={training.loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { training.setCollapsed(true); setManuallyOpened(false); }}
            title="Minimize"
            aria-label="Minimize training"
            className="p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100"
          >
            <ChevronDown size={15} />
          </button>
          <button
            onClick={training.dismiss}
            title="Dismiss training"
            aria-label="Dismiss training"
            className="p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between text-[11px] font-medium text-gray-400 mb-1.5">
          <span>{doneCount} of {total} complete</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent), var(--secondary))' }}
          />
        </div>
      </div>

      {/* Milestones */}
      <ol className="px-4 py-3 space-y-1 max-h-[46vh] overflow-y-auto">
        {milestones.map((m, i) => {
          const isActive = i === activeIndex;
          return (
            <li key={m.def.id}>
              <div className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 ${isActive ? 'bg-gray-50' : ''}`}>
                <span
                  className={`mt-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                    m.done
                      ? 'bg-green-100 text-green-600'
                      : isActive
                        ? 'text-white'
                        : 'bg-gray-100 text-gray-400'
                  }`}
                  style={isActive && !m.done ? { backgroundColor: 'var(--accent)' } : undefined}
                >
                  {m.done ? <Check size={11} strokeWidth={3} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] leading-snug ${
                    m.done ? 'text-gray-400 line-through' : isActive ? 'font-semibold text-gray-900' : 'text-gray-600'
                  }`}>
                    {m.def.title}
                  </div>
                  {isActive && (
                    <>
                      <p className="text-[12px] text-gray-500 leading-relaxed mt-1">{m.def.body}</p>
                      <button
                        onClick={() => go(m.def.id)}
                        className="btn-primary text-xs mt-2.5 w-full justify-center"
                      >
                        {m.def.cta} <ArrowRight size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {active && (
        <div className="px-4 pb-3 -mt-1">
          <p className="text-[11px] text-gray-400 flex items-start gap-1.5 leading-snug">
            <Sparkles size={12} className="mt-0.5 flex-shrink-0" />
            Steps tick themselves off from your real account — nothing here is self-reported.
          </p>
        </div>
      )}
    </Shell>
  );
}

/** Below desktop width the coach starts as a pill instead of covering half the
 *  screen — the docked panel (and the gutter pages leave for it) is a
 *  desktop-only affordance. Falls back to "not narrow" without matchMedia. */
function useIsNarrow(): boolean {
  const query = '(max-width: 1023px)';
  const [narrow, setNarrow] = useState(() => {
    try { return window.matchMedia(query).matches; } catch { return false; }
  });
  useEffect(() => {
    let mql: MediaQueryList;
    try { mql = window.matchMedia(query); } catch { return; }
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    setNarrow(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return narrow;
}

/** True once the first-run welcome is out of the way. Only manager/developer
 *  accounts ever see that welcome, so everyone else starts coached right away. */
function useWelcomeDone(role: string | undefined): boolean {
  const showsWelcome = role === 'manager' || role === 'developer';
  const [done, setDone] = useState(!showsWelcome);

  useEffect(() => {
    if (!showsWelcome) { setDone(true); return; }
    let cancelled = false;
    const truthy = (v: unknown) => ['true', '1', 'yes'].includes(String(v ?? '').toLowerCase());
    api.getCompanySettings()
      .then(settings => { if (!cancelled) setDone(truthy(settings?.onboarding_completed)); })
      // If settings can't be read we'd rather coach than go silent.
      .catch(() => { if (!cancelled) setDone(true); });
    const onFinished = () => setDone(true);
    window.addEventListener(ONBOARDING_DONE_EVENT, onFinished);
    return () => { cancelled = true; window.removeEventListener(ONBOARDING_DONE_EVENT, onFinished); };
  }, [showsWelcome]);

  return done;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed z-[45] bottom-4 right-4 left-4 sm:left-auto sm:w-[360px] max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden">
      {children}
    </div>
  );
}

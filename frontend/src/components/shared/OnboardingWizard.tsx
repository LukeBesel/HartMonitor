import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Database, Users, CheckCircle2, RefreshCw, X, ArrowRight,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const TOTAL_STEPS = 4;

function isTruthy(v: any): boolean {
  if (v === undefined || v === null) return false;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

export default function OnboardingWizard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [step, setStep] = useState(1);

  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [sampleError, setSampleError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getCompanySettings()
      .then(settings => {
        if (cancelled) return;
        const completed = isTruthy(settings?.onboarding_completed);
        const roleOk = user?.role === 'manager' || user?.role === 'developer';
        setEligible(!completed && roleOk);
      })
      .catch(() => {
        // If we can't load settings, don't show the wizard.
        setEligible(false);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
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
    setClosed(true);
    api.updateCompanySettings({ onboarding_completed: 'true' }).catch(() => {});
    navigate('/settings?tab=users');
  };

  if (!ready || closed || !eligible) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-400">
            Step {step} of {TOTAL_STEPS}
          </div>
          <button onClick={finish} className="text-gray-400 hover:text-gray-600" title="Skip setup">
            <X size={18} />
          </button>
        </div>

        {/* Step indicator dots */}
        <div className="flex items-center gap-1.5 px-6 pt-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <span
              key={i}
              className="h-1.5 flex-1 rounded-full transition-colors"
              style={{
                background: i + 1 <= step ? 'linear-gradient(135deg, var(--accent), var(--secondary))' : '#e5e7eb',
              }}
            />
          ))}
        </div>

        <div className="px-6 py-6">
          {step === 1 && (
            <div className="text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}
              >
                <Sparkles size={26} />
              </div>
              <h2 className="text-lg font-bold text-gray-900">Welcome to your MES</h2>
              <p className="text-sm text-gray-500 mt-2">
                This is your command center for managing apps, work orders, inventory, and quality
                across your shop floor. Let's get you set up in just a couple of steps.
              </p>
              <div className="flex flex-col items-center gap-2 mt-6">
                <button onClick={() => setStep(2)} className="btn-primary w-full justify-center">
                  Get Started <ArrowRight size={14} />
                </button>
                <button onClick={finish} className="text-xs text-gray-400 hover:text-gray-600 mt-1">
                  Skip setup
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}
              >
                <Database size={26} />
              </div>
              <h2 className="text-lg font-bold text-gray-900">Load Sample Data</h2>
              <p className="text-sm text-gray-500 mt-2">
                Populate your org with example apps, work orders, stations, and inventory so you can
                explore the product right away. You can remove this data anytime later.
              </p>

              {sampleError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-4">{sampleError}</p>
              )}

              {sampleLoaded ? (
                <div className="flex items-center justify-center gap-2 mt-6 text-green-600 text-sm font-medium">
                  <CheckCircle2 size={16} /> Sample data loaded!
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 mt-6">
                  <button
                    onClick={handleLoadSampleData}
                    disabled={loadingSample}
                    className="btn-primary w-full justify-center"
                  >
                    {loadingSample ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" /> Loading…
                      </>
                    ) : (
                      'Load Sample Data'
                    )}
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between mt-5">
                <button onClick={finish} className="text-xs text-gray-400 hover:text-gray-600">
                  Skip setup
                </button>
                <button onClick={() => setStep(3)} className="btn-secondary text-sm">
                  {sampleLoaded ? 'Continue' : 'Skip'} <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}
              >
                <Users size={26} />
              </div>
              <h2 className="text-lg font-bold text-gray-900">Invite Your Team</h2>
              <p className="text-sm text-gray-500 mt-2">
                Bring your operators, supervisors, and managers on board so everyone can collaborate
                from day one. You can manage users and roles anytime from Settings.
              </p>
              <div className="flex flex-col items-center gap-2 mt-6">
                <button onClick={goToUsers} className="btn-primary w-full justify-center">
                  Invite Team Members <ArrowRight size={14} />
                </button>
              </div>
              <div className="flex items-center justify-between mt-5">
                <button onClick={finish} className="text-xs text-gray-400 hover:text-gray-600">
                  Skip setup
                </button>
                <button onClick={() => setStep(4)} className="btn-secondary text-sm">
                  Skip <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}
              >
                <CheckCircle2 size={26} />
              </div>
              <h2 className="text-lg font-bold text-gray-900">You're all set!</h2>
              <p className="text-sm text-gray-500 mt-2">
                Your workspace is ready to go. Explore the dashboard, build apps, and manage your
                production floor whenever you're ready.
              </p>
              <div className="flex flex-col items-center gap-2 mt-6">
                <button onClick={finish} className="btn-primary w-full justify-center">
                  Finish
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

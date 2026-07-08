import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { App, Widget, Step, WorkOrder, ProductType, Station } from '../types';
import {
  ChevronLeft, ChevronRight, CheckCircle, X, Clock, Factory,
  AlertCircle, Loader2, AlertTriangle, Zap, Tag, Info, Package,
} from 'lucide-react';
import { CanvasStage } from '../components/app/WidgetView';

export default function AppPlayer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [app, setApp] = useState<App | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [stepTimes, setStepTimes] = useState<Record<number, number>>({});
  const [stepStartTime, setStepStartTime] = useState<number>(Date.now());
  const [stepElapsed, setStepElapsed] = useState(0);
  const [completionId, setCompletionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'setup' | 'running' | 'completed' | 'abandoned'>('setup');
  const [operatorName, setOperatorName] = useState('');
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState('');
  const [selectedProductTypeId, setSelectedProductTypeId] = useState('');
  const [selectedStationId, setSelectedStationId] = useState(() => localStorage.getItem('hm_station') || '');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [taktExceededSteps, setTaktExceededSteps] = useState<number[]>([]);
  const [flashPhase, setFlashPhase] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showPartsOverlay, setShowPartsOverlay] = useState(false);

  const loadAll = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([api.getApp(id), api.getWorkOrders(), api.getProductTypes(id), api.getStations()]).then(([a, wos, pts, sts]) => {
      setApp(a);
      setWorkOrders(wos.filter((w: WorkOrder) => w.app_id === id && w.status !== 'completed' && w.status !== 'cancelled'));
      setProductTypes(pts);
      setStations(sts.filter((s: Station) => s.status === 'active'));
      // Pre-fill from URL params (coming from Operator Portal or a station kiosk link)
      const woParam = searchParams.get('wo');
      const nameParam = searchParams.get('name');
      const stationParam = searchParams.get('station');
      if (woParam) setSelectedWorkOrderId(woParam);
      if (nameParam) setOperatorName(nameParam);
      if (stationParam) setSelectedStationId(stationParam);
      setLoading(false);
    }).catch((err: any) => {
      setLoadError(err.message || 'Failed to load app');
      setLoading(false);
    });
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Step elapsed timer
  useEffect(() => {
    if (status !== 'running') return;
    const interval = setInterval(() => {
      setStepElapsed(Math.round((Date.now() - stepStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, stepStartTime]);

  const currentStep = app?.steps[currentStepIdx];

  // Resolve takt time: product type override takes priority over step default
  const getStepTakt = (idx: number): number => {
    const step = app?.steps[idx];
    if (!step) return 0;
    if (selectedProductTypeId) {
      const pt = productTypes.find(p => p.id === selectedProductTypeId);
      if (pt && pt.takt_overrides[idx] !== undefined) return Number(pt.takt_overrides[idx]);
      if (pt && pt.takt_overrides[String(idx)] !== undefined) return Number(pt.takt_overrides[String(idx)]);
    }
    return step.takt_time_seconds ?? 0;
  };

  const stepTaktSeconds = getStepTakt(currentStepIdx);
  const isOverTakt = stepTaktSeconds > 0 && stepElapsed > stepTaktSeconds;

  // Takt flash effect
  useEffect(() => {
    if (!isOverTakt) { setFlashPhase(false); return; }
    const interval = setInterval(() => setFlashPhase(f => !f), 600);
    return () => clearInterval(interval);
  }, [isOverTakt]);

  // Track exceeded steps
  useEffect(() => {
    if (isOverTakt && !taktExceededSteps.includes(currentStepIdx)) {
      setTaktExceededSteps(prev => [...prev, currentStepIdx]);
    }
  }, [isOverTakt, currentStepIdx]);

  const startRun = async () => {
    if (!app || !id || starting) return;
    if (selectedStationId) localStorage.setItem('hm_station', selectedStationId);
    else localStorage.removeItem('hm_station');
    setStarting(true);
    setActionError(null);
    try {
      const c = await api.createCompletion({
        app_id: id,
        operator_name: operatorName || 'Operator',
        work_order_id: selectedWorkOrderId || undefined,
        product_type_id: selectedProductTypeId || undefined,
        station_id: selectedStationId || undefined,
      });
      setCompletionId(c.id);
      setStepStartTime(Date.now());
      setStepElapsed(0);
      setStatus('running');
    } catch (err: any) {
      setActionError(err.message || 'Failed to start process');
    } finally {
      setStarting(false);
    }
  };

  const recordStepTime = useCallback((stepIdx: number) => {
    const elapsed = Math.round((Date.now() - stepStartTime) / 1000);
    setStepTimes(prev => ({ ...prev, [stepIdx]: elapsed }));
  }, [stepStartTime]);

  const REQUIRED_WIDGET_TYPES = ['text-input', 'number-input', 'select-input', 'checkbox'];

  const getMissingRequiredFields = (stepIdx: number): string[] => {
    const step = app?.steps[stepIdx];
    if (!step) return [];
    return step.widgets
      .filter(w => REQUIRED_WIDGET_TYPES.includes(w.type) && w.config.required)
      .filter(w => {
        const val = formData[w.config.variableName || w.id];
        if (w.type === 'checkbox') return val !== true;
        return val === undefined || val === null || val === '';
      })
      .map(w => w.label || 'This field');
  };

  const goNext = () => {
    if (!app) return;
    const missing = getMissingRequiredFields(currentStepIdx);
    if (missing.length > 0) {
      setValidationError(`Please fill in required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
      return;
    }
    setValidationError(null);
    setShowPartsOverlay(false);
    recordStepTime(currentStepIdx);
    setCurrentStepIdx(i => i + 1);
    setStepStartTime(Date.now());
    setStepElapsed(0);
  };

  const goPrev = () => {
    setValidationError(null);
    setShowPartsOverlay(false);
    recordStepTime(currentStepIdx);
    setCurrentStepIdx(i => Math.max(0, i - 1));
    setStepStartTime(Date.now());
    setStepElapsed(0);
  };

  const complete = async () => {
    if (!completionId || !app || completing) return;
    const missing = getMissingRequiredFields(currentStepIdx);
    if (missing.length > 0) {
      setValidationError(`Please fill in required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
      return;
    }
    setValidationError(null);
    recordStepTime(currentStepIdx);
    const finalStepTimes = { ...stepTimes, [currentStepIdx]: Math.round((Date.now() - stepStartTime) / 1000) };
    setCompleting(true);
    try {
      await api.updateCompletion(completionId, {
        status: 'completed', data: formData,
        step_times: finalStepTimes,
        takt_exceeded_steps: taktExceededSteps,
      });
      setStatus('completed');
    } catch (err: any) {
      setValidationError(err.message || 'Failed to save completion — please try again');
    } finally {
      setCompleting(false);
    }
  };

  const abandon = async () => {
    if (completionId) {
      try {
        await api.updateCompletion(completionId, { status: 'abandoned', data: formData });
      } catch {
        // Still exit the run locally — the operator asked to stop.
      }
    }
    setStatus('abandoned');
  };

  const updateField = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setValidationError(null);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-gray-950">
      <Loader2 size={32} className="animate-spin text-blue-400" />
    </div>
  );

  if (loadError) return (
    <div className="flex items-center justify-center h-screen bg-gray-950 text-white">
      <div className="text-center">
        <AlertTriangle size={40} className="mx-auto mb-3 text-red-400" />
        <p className="text-xl font-semibold">Couldn't load app</p>
        <p className="text-gray-400 text-sm mt-1">{loadError}</p>
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={loadAll} className="btn-secondary">Retry</button>
          <button onClick={() => navigate('/apps')} className="btn-secondary">Back to Library</button>
        </div>
      </div>
    </div>
  );

  if (!app) return (
    <div className="flex items-center justify-center h-screen bg-gray-950 text-white">
      <div className="text-center">
        <AlertCircle size={40} className="mx-auto mb-3 text-red-400" />
        <p className="text-xl font-semibold">App not found</p>
        <button onClick={() => navigate('/apps')} className="mt-4 btn-secondary">Back to Library</button>
      </div>
    </div>
  );

  // Setup screen
  if (status === 'setup') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 sm:p-6">
        <div className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Factory size={26} className="text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{app.name}</h1>
            {app.description && <p className="text-gray-500 text-sm mt-1">{app.description}</p>}
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center text-xs text-gray-500 bg-gray-50 rounded-xl p-3">
              <div><div className="font-bold text-gray-900 text-lg">{app.steps.length}</div>Steps</div>
              <div><div className="font-bold text-gray-900 text-lg">{app.steps.reduce((a,s) => a + s.widgets.length, 0)}</div>Widgets</div>
              <div><div className="font-bold text-gray-900 text-lg">{app.steps.filter(s => s.takt_time_seconds).length}</div>Timed</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Operator Name</label>
              <input className="input-field" placeholder="Enter your name..." value={operatorName}
                onChange={e => setOperatorName(e.target.value)} onKeyDown={e => e.key === 'Enter' && startRun()} autoFocus />
            </div>
            {stations.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Station (optional)</label>
                <select className="input-field" value={selectedStationId} onChange={e => setSelectedStationId(e.target.value)}>
                  <option value="">— No station —</option>
                  {stations.map(s => (
                    <option key={s.id} value={s.id}>{s.name}{s.location ? ` · ${s.location}` : ''}</option>
                  ))}
                </select>
              </div>
            )}
            {productTypes.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
                  <Tag size={13} className="text-purple-500" /> Product Type
                </label>
                <select className="input-field" value={selectedProductTypeId} onChange={e => setSelectedProductTypeId(e.target.value)}>
                  <option value="">— Standard (default takt) —</option>
                  {productTypes.map(pt => (
                    <option key={pt.id} value={pt.id}>{pt.name}{pt.description ? ` — ${pt.description}` : ''}</option>
                  ))}
                </select>
              </div>
            )}
            {workOrders.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Work Order (optional)</label>
                <select className="input-field" value={selectedWorkOrderId} onChange={e => setSelectedWorkOrderId(e.target.value)}>
                  <option value="">— No work order —</option>
                  {workOrders.map(wo => (
                    <option key={wo.id} value={wo.id}>{wo.work_order_number} · {wo.part_name} ({wo.quantity_completed}/{wo.quantity})</option>
                  ))}
                </select>
              </div>
            )}
            {actionError && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                <AlertCircle size={15} className="flex-shrink-0" />
                {actionError}
              </div>
            )}
            <button onClick={startRun} disabled={starting} className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-base transition-colors shadow-lg shadow-blue-600/20 disabled:opacity-60 disabled:cursor-not-allowed">
              {starting ? 'Starting…' : 'Start Process'}
            </button>
            <button onClick={() => navigate('/apps')} className="w-full py-2 text-sm text-gray-400 hover:text-gray-600">
              ← Back to Library
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Completed screen
  if (status === 'completed') {
    const totalSeconds = Object.values(stepTimes).reduce((a: any, b: any) => a + b, 0) +
      Math.round((Date.now() - stepStartTime) / 1000);
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 sm:p-6">
        <div className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={32} className="text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Complete!</h1>
            <p className="text-gray-500 text-sm mt-1">{app.name} · {operatorName || 'Operator'}</p>
            {selectedProductTypeId && (
              <p className="text-xs text-purple-600 mt-0.5 flex items-center justify-center gap-1">
                <Tag size={11} /> {productTypes.find(p => p.id === selectedProductTypeId)?.name}
              </p>
            )}
          </div>
          {taktExceededSteps.length > 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-700">
                <span className="font-semibold">Takt time exceeded</span> on {taktExceededSteps.length} step{taktExceededSteps.length > 1 ? 's' : ''}: {taktExceededSteps.map(i => app.steps[i]?.name).join(', ')}
              </div>
            </div>
          )}
          <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-2">
            <div className="flex justify-between text-sm font-semibold text-gray-700 pb-1 border-b border-gray-200 mb-2">
              <span>Step</span><span>Time</span>
            </div>
            {app.steps.map((step, i) => {
              const t = stepTimes[i] ?? 0;
              const taktS = getStepTakt(i);
              const exceeded = taktS > 0 && t > taktS;
              return (
                <div key={step.id} className="flex justify-between text-sm">
                  <span className="text-gray-600">{step.name}</span>
                  <span className={`font-medium ${exceeded ? 'text-red-600' : 'text-gray-900'}`}>
                    {t ? formatDur(t) : '—'} {exceeded ? '⚠' : ''}
                  </span>
                </div>
              );
            })}
            <div className="pt-2 border-t border-gray-200 flex justify-between text-sm font-bold">
              <span>Total</span><span>{formatDur(totalSeconds)}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setStatus('setup'); setCurrentStepIdx(0); setFormData({}); setStepTimes({}); setCompletionId(null); setTaktExceededSteps([]); setSelectedProductTypeId(''); }} className="btn-primary flex-1 justify-center">
              Run Again
            </button>
            <button onClick={() => navigate('/apps')} className="btn-secondary flex-1 justify-center">
              Exit
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'abandoned') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 sm:p-6">
        <div className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-md text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <X size={32} className="text-gray-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Process Abandoned</h1>
          <p className="text-gray-500 mb-6 text-sm">Stopped before completion.</p>
          <div className="flex gap-3">
            <button onClick={() => { setStatus('setup'); setCurrentStepIdx(0); setFormData({}); setStepTimes({}); setCompletionId(null); setTaktExceededSteps([]); }} className="btn-primary flex-1 justify-center">Start Over</button>
            <button onClick={() => navigate('/apps')} className="btn-secondary flex-1 justify-center">Exit</button>
          </div>
        </div>
      </div>
    );
  }

  // Running
  const progress = app.steps.length > 0 ? ((currentStepIdx + 1) / app.steps.length) * 100 : 0;
  const taktPct = stepTaktSeconds > 0 ? Math.min(100, (stepElapsed / stepTaktSeconds) * 100) : 0;

  const bgClass = isOverTakt
    ? (flashPhase ? 'bg-red-950' : 'bg-red-900')
    : 'bg-gray-950';

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-300 ${bgClass}`}>
      {/* Takt exceeded banner */}
      {isOverTakt && (
        <div className={`flex-shrink-0 flex items-center justify-center gap-3 py-2.5 text-white text-sm font-bold tracking-wide ${flashPhase ? 'bg-red-600' : 'bg-red-700'} transition-colors`}>
          <AlertTriangle size={16} className="animate-bounce" />
          TAKT TIME EXCEEDED — {formatDur(stepElapsed - stepTaktSeconds)} OVER
          <Zap size={16} className="animate-bounce" />
        </div>
      )}

      {/* Header */}
      <div className="bg-gray-900 border-b border-white/10 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Factory size={16} className="text-white" />
          </div>
          <div>
            <div className="text-white font-semibold text-sm">{app.name}</div>
            <div className="text-gray-400 text-xs">{operatorName || 'Operator'}</div>
          </div>
        </div>
        <div className="flex items-center gap-5">
          {/* Takt timer */}
          {stepTaktSeconds > 0 && (
            <div className="text-center">
              <div className={`font-mono font-bold text-lg ${isOverTakt ? 'text-red-400' : stepElapsed > stepTaktSeconds * 0.8 ? 'text-amber-400' : 'text-green-400'}`}>
                {isOverTakt ? `+${formatDur(stepElapsed - stepTaktSeconds)}` : formatDur(stepTaktSeconds - stepElapsed)}
              </div>
              <div className="text-gray-500 text-[10px] uppercase tracking-wide">{isOverTakt ? 'Over Takt' : 'Remaining'}</div>
            </div>
          )}
          <div className="text-center">
            <div className="text-white font-bold">{currentStepIdx + 1} / {app.steps.length}</div>
            <div className="text-gray-400 text-xs">Steps</div>
          </div>
          <button onClick={() => { if (confirm('Stop this process?')) abandon(); }}
            className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-red-400 transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-800 flex-shrink-0">
        <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {/* Takt time bar */}
      {stepTaktSeconds > 0 && (
        <div className="h-1.5 bg-gray-800 flex-shrink-0">
          <div
            className={`h-full transition-all ${isOverTakt ? 'bg-red-500' : taktPct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${taktPct}%` }}
          />
        </div>
      )}

      {/* Step tabs */}
      <div className="bg-gray-900 border-b border-white/10 flex items-center gap-0.5 px-4 py-2 overflow-x-auto flex-shrink-0">
        {app.steps.map((step, idx) => (
          <div key={step.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
            idx === currentStepIdx ? 'bg-blue-600 text-white' :
            idx < currentStepIdx ? 'text-emerald-400' : 'text-gray-500'
          }`}>
            {idx < currentStepIdx ? <CheckCircle size={11} /> :
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-xs border ${
                idx === currentStepIdx ? 'border-white bg-white text-blue-600' : 'border-gray-600 text-gray-600'
              }`}>{idx + 1}</span>}
            {step.name}
            {getStepTakt(idx) > 0 ? <Clock size={10} className="opacity-60" /> : null}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto flex justify-center py-8 px-4">
        <div className={`w-full space-y-4 ${currentStep?.layoutMode === 'canvas' ? 'max-w-3xl' : 'max-w-2xl'}`}>
          <div className="flex items-center justify-between mb-4 gap-3">
            <h2 className="text-2xl font-bold text-white flex-1">{currentStep?.name}</h2>
            <div className="flex items-center gap-2 flex-shrink-0">
              {(currentStep?.parts_list?.length ?? 0) > 0 && (
                <button
                  onClick={() => setShowPartsOverlay(o => !o)}
                  title="View parts & materials for this step"
                  className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-500/90 text-white text-xs font-medium transition-colors"
                >
                  <Package size={13} />
                  Parts
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-pink-500 rounded-full text-[9px] flex items-center justify-center font-bold">
                    {currentStep!.parts_list!.length}
                  </span>
                </button>
              )}
              {stepTaktSeconds > 0 && (
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                  isOverTakt ? 'bg-red-800/60 text-red-300' : 'bg-white/10 text-gray-300'
                }`}>
                  <Clock size={13} />
                  Takt: {formatDur(stepTaktSeconds)} · Now: {formatDur(stepElapsed)}
                </div>
              )}
            </div>
          </div>

          {/* Parts overlay — slides in below the step header */}
          {showPartsOverlay && currentStep?.parts_list && currentStep.parts_list.length > 0 && (
            <div className="mb-4 bg-indigo-950/80 border border-indigo-500/30 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-white font-semibold text-sm">
                  <Package size={15} className="text-indigo-400" />
                  Parts &amp; Materials — {currentStep.name}
                </div>
                <button onClick={() => setShowPartsOverlay(false)} className="p-1 rounded-lg hover:bg-white/10 text-gray-400">
                  <X size={14} />
                </button>
              </div>
              <div className="space-y-1">
                {currentStep.parts_list.map((part, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0">
                    <div className="w-6 h-6 rounded-md bg-indigo-800/60 flex items-center justify-center flex-shrink-0">
                      <Package size={11} className="text-indigo-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-white text-sm font-medium">{part.name}</span>
                      {part.sku && <span className="text-gray-400 text-xs ml-2">#{part.sku}</span>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-indigo-300 font-bold text-sm">{part.quantity}</span>
                      {part.unit && <span className="text-gray-400 text-xs ml-1">{part.unit}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {validationError && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-900/40 border border-red-700 rounded-xl text-red-300 text-sm font-medium">
              <AlertCircle size={16} className="flex-shrink-0" />
              {validationError}
            </div>
          )}
          {currentStep?.layoutMode === 'canvas' ? (
            <CanvasStage
              widgets={currentStep.widgets}
              height={currentStep.canvasHeight ?? 560}
              background={currentStep.canvasBackground}
              values={formData}
              onChange={(key, val) => updateField(key, val)}
              onNext={goNext}
              onPrev={goPrev}
              onComplete={complete}
            />
          ) : (
            currentStep?.widgets.map(widget => (
              <PlayerWidget
                key={widget.id}
                widget={widget}
                value={formData[widget.config.variableName || widget.id]}
                onChange={(val) => updateField(widget.config.variableName || widget.id, val)}
                onNext={goNext}
                onPrev={goPrev}
                onComplete={complete}
                isLastStep={currentStepIdx === app.steps.length - 1}
                isFirstStep={currentStepIdx === 0}
              />
            ))
          )}
        </div>
      </div>

      {/* Footer nav — large touch targets for shop-floor tablets */}
      <div className="bg-gray-900 border-t border-white/10 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-shrink-0"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <button onClick={goPrev} disabled={currentStepIdx === 0}
          className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <ChevronLeft size={18} /> <span className="hidden sm:inline">Previous</span>
        </button>
        <div className="text-gray-500 text-xs font-mono">{formatDur(stepElapsed)}</div>
        {currentStepIdx < app.steps.length - 1 ? (
          <button onClick={goNext}
            className="flex items-center gap-2 px-6 sm:px-8 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-base font-semibold transition-colors shadow-lg shadow-blue-600/20">
            Next <ChevronRight size={18} />
          </button>
        ) : (
          <button onClick={complete} disabled={completing}
            className="flex items-center gap-2 px-6 sm:px-8 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-base font-semibold transition-colors shadow-lg shadow-emerald-600/20 disabled:opacity-60 disabled:cursor-not-allowed">
            {completing ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
            {completing ? 'Saving…' : 'Complete'}
          </button>
        )}
      </div>
    </div>
  );
}

function PlayerWidget({ widget, value, onChange, onNext, onPrev, onComplete, isLastStep, isFirstStep }: {
  widget: Widget; value: any; onChange: (v: any) => void;
  onNext: () => void; onPrev: () => void; onComplete: () => void;
  isLastStep: boolean; isFirstStep: boolean;
}) {
  const { config } = widget;
  const [timerRunning, setTimerRunning] = useState(!!config.autoStart);
  const [timerLeft, setTimerLeft] = useState(config.duration || 60);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [counterVal, setCounterVal] = useState<number>(config.initialValue ?? 0);

  useEffect(() => {
    if (timerRunning && timerLeft > 0) {
      timerRef.current = setInterval(() => setTimerLeft(t => {
        if (t <= 1) { setTimerRunning(false); clearInterval(timerRef.current!); return 0; }
        return t - 1;
      }), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  const handleCounter = (delta: number) => {
    const min = config.min ?? 0, max = config.max ?? 9999, step = config.step ?? 1;
    const newVal = Math.min(max, Math.max(min, counterVal + delta * step));
    setCounterVal(newVal);
    onChange(newVal);
  };

  const baseInput = "w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base";

  switch (widget.type) {
    case 'text':
      return <p className="text-gray-200 leading-relaxed" style={{ fontSize: config.fontSize || 16, fontWeight: config.fontWeight || 'normal', color: config.color || '#e5e7eb' }}>{config.text}</p>;
    case 'instruction':
      return <div className="rounded-xl p-5 border border-gray-700" style={{ backgroundColor: '#1e3a5f' }}><div className="text-gray-100 text-sm leading-relaxed whitespace-pre-wrap">{config.content}</div></div>;
    case 'separator':
      return <div className="border-t border-gray-800 my-2" />;
    case 'image':
      return config.imageUrl ? <img src={config.imageUrl} alt={config.imageAlt || ''} className="w-full rounded-xl max-h-64 object-contain bg-gray-800 p-2" />
        : <div className="w-full h-32 bg-gray-800 rounded-xl flex items-center justify-center text-gray-600 text-sm border border-dashed border-gray-700">Image placeholder</div>;
    case 'text-input':
      return (
        <div>
          {widget.label && <label className="block text-sm font-medium text-gray-300 mb-2">{widget.label}{config.required && <span className="text-red-400 ml-1">*</span>}</label>}
          <input type="text" className={baseInput} placeholder={config.placeholder} value={value || ''} onChange={e => onChange(e.target.value)} />
        </div>
      );
    case 'number-input':
      return (
        <div>
          {widget.label && <label className="block text-sm font-medium text-gray-300 mb-2">{widget.label}{config.required && <span className="text-red-400 ml-1">*</span>}</label>}
          <input type="number" className={baseInput} placeholder={config.placeholder} value={value || ''} onChange={e => onChange(e.target.value)} min={config.min} max={config.max} step={config.step} />
        </div>
      );
    case 'select-input':
      return (
        <div>
          {widget.label && <label className="block text-sm font-medium text-gray-300 mb-2">{widget.label}{config.required && <span className="text-red-400 ml-1">*</span>}</label>}
          <div className="flex flex-wrap gap-2">
            {(config.options || []).map(opt => (
              <button key={opt} onClick={() => onChange(opt)}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all border-2 ${value === opt ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'}`}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      );
    case 'checkbox':
      return (
        <label className="flex items-center gap-4 cursor-pointer p-4 bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-600 transition-colors">
          <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-colors ${value ? 'bg-blue-600 border-blue-500' : 'border-gray-600'}`} onClick={() => onChange(!value)}>
            {value && <CheckCircle size={14} className="text-white" />}
          </div>
          <span className="text-gray-200 font-medium">{widget.label}{config.required && <span className="text-red-400 ml-1">*</span>}</span>
        </label>
      );
    case 'timer': {
      const pct = (timerLeft / (config.duration || 60)) * 100;
      return (
        <div className="bg-gray-800 rounded-xl p-6 text-center border border-gray-700">
          {widget.label && <div className="text-gray-400 text-sm mb-3 font-medium">{widget.label}</div>}
          <div className="text-5xl font-mono font-bold text-white mb-4">{formatDur(timerLeft)}</div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-4">
            <div className={`h-full rounded-full transition-all ${timerLeft < 30 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex gap-2 justify-center">
            <button onClick={() => setTimerRunning(!timerRunning)} className={`px-4 py-2 rounded-lg text-sm font-medium ${timerRunning ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
              {timerRunning ? 'Pause' : timerLeft === 0 ? 'Reset' : 'Start'}
            </button>
            <button onClick={() => { setTimerLeft(config.duration || 60); setTimerRunning(false); }} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-300">Reset</button>
          </div>
        </div>
      );
    }
    case 'counter':
      return (
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          {widget.label && <div className="text-gray-400 text-sm font-medium mb-4">{widget.label}</div>}
          <div className="flex items-center justify-between gap-4">
            <button onClick={() => handleCounter(-1)} disabled={counterVal <= (config.min ?? 0)}
              className="w-14 h-14 rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-2xl font-bold transition-colors disabled:opacity-40">−</button>
            <div className="text-center">
              <div className="text-5xl font-mono font-bold text-white">{counterVal}</div>
              <div className="text-gray-500 text-xs mt-1">{config.min ?? 0} — {config.max ?? '∞'}</div>
            </div>
            <button onClick={() => handleCounter(1)} disabled={counterVal >= (config.max ?? 9999)}
              className="w-14 h-14 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-2xl font-bold transition-colors disabled:opacity-40">+</button>
          </div>
        </div>
      );
    case 'pass-fail':
      return (
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          {widget.label && <div className="text-gray-300 font-medium mb-4">{widget.label}</div>}
          <div className="flex gap-3">
            <button onClick={() => onChange('Pass')} className={`flex-1 py-5 rounded-xl text-lg font-bold transition-all border-2 ${value === 'Pass' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-emerald-700 hover:text-emerald-400'}`}>
              ✓ Pass
            </button>
            <button onClick={() => onChange('Fail')} className={`flex-1 py-5 rounded-xl text-lg font-bold transition-all border-2 ${value === 'Fail' ? 'bg-red-600 border-red-500 text-white' : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-red-700 hover:text-red-400'}`}>
              ✗ Fail
            </button>
          </div>
        </div>
      );
    case 'signature':
      return (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          {widget.label && <div className="text-gray-300 font-medium mb-3">{widget.label}</div>}
          {value ? (
            <div className="text-center py-4">
              <div className="text-green-400 font-medium italic text-2xl mb-2" style={{ fontFamily: 'cursive' }}>{value}</div>
              <button onClick={() => onChange('')} className="text-xs text-gray-500 hover:text-red-400">Clear</button>
            </div>
          ) : (
            <input className={`${baseInput} text-center italic`} style={{ fontFamily: 'cursive' }}
              placeholder="Type your signature..." onBlur={e => e.target.value && onChange(e.target.value)} />
          )}
        </div>
      );
    case 'button': {
      const handleClick = () => {
        if (config.buttonType === 'next') onNext();
        else if (config.buttonType === 'prev') onPrev();
        else if (config.buttonType === 'complete') onComplete();
      };
      const sizeClass = config.buttonSize === 'sm' ? 'py-2 text-sm' : config.buttonSize === 'lg' ? 'py-5 text-xl' : 'py-3.5 text-base';
      return (
        <button onClick={handleClick} className={`w-full ${sizeClass} rounded-xl font-semibold text-white transition-all hover:opacity-90 active:scale-[0.99]`}
          style={{ backgroundColor: config.buttonColor || '#3b82f6' }}>
          {config.buttonText || 'Next'}
        </button>
      );
    }
    default: return null;
  }
}

function formatDur(s: number): string {
  const m = Math.floor(Math.abs(s) / 60);
  const sec = Math.abs(s) % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

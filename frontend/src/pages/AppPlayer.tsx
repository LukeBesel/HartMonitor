import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { App, Widget, Step } from '../types';
import {
  ChevronLeft, ChevronRight, CheckCircle, X, Clock, Factory,
  AlertCircle, User, Monitor, Loader2
} from 'lucide-react';

export default function AppPlayer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [app, setApp] = useState<App | null>(null);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [stepTimes, setStepTimes] = useState<Record<number, number>>({});
  const [stepStartTime, setStepStartTime] = useState<number>(Date.now());
  const [completionId, setCompletionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'setup' | 'running' | 'completed' | 'abandoned'>('setup');
  const [operatorName, setOperatorName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) api.getApp(id).then(a => { setApp(a); setLoading(false); });
  }, [id]);

  const startRun = async () => {
    if (!app || !id) return;
    const c = await api.createCompletion({ app_id: id, operator_name: operatorName || 'Operator' });
    setCompletionId(c.id);
    setStepStartTime(Date.now());
    setStatus('running');
  };

  const recordStepTime = useCallback((stepIdx: number) => {
    const elapsed = Math.round((Date.now() - stepStartTime) / 1000);
    setStepTimes(prev => ({ ...prev, [stepIdx]: elapsed }));
    setStepStartTime(Date.now());
  }, [stepStartTime]);

  const goNext = async () => {
    if (!app) return;
    recordStepTime(currentStepIdx);
    if (currentStepIdx < app.steps.length - 1) {
      setCurrentStepIdx(i => i + 1);
    }
  };

  const goPrev = () => {
    recordStepTime(currentStepIdx);
    setCurrentStepIdx(i => Math.max(0, i - 1));
  };

  const complete = async () => {
    if (!completionId || !app) return;
    recordStepTime(currentStepIdx);
    const finalStepTimes = { ...stepTimes, [currentStepIdx]: Math.round((Date.now() - stepStartTime) / 1000) };
    await api.updateCompletion(completionId, {
      status: 'completed',
      data: formData,
      step_times: finalStepTimes,
    });
    setStatus('completed');
  };

  const abandon = async () => {
    if (completionId) {
      await api.updateCompletion(completionId, { status: 'abandoned', data: formData });
    }
    setStatus('abandoned');
  };

  const updateField = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <Loader2 size={32} className="animate-spin text-blue-400" />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-center">
          <AlertCircle size={40} className="mx-auto mb-3 text-red-400" />
          <p className="text-xl font-semibold">App not found</p>
          <button onClick={() => navigate('/apps')} className="mt-4 btn-secondary">Back to Library</button>
        </div>
      </div>
    );
  }

  // Setup screen
  if (status === 'setup') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Factory size={26} className="text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{app.name}</h1>
            {app.description && <p className="text-gray-500 text-sm mt-1">{app.description}</p>}
          </div>
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
              <Monitor size={16} className="text-blue-500" />
              <span>{app.steps.length} steps to complete</span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                <User size={14} className="inline mr-1" />Operator Name
              </label>
              <input
                className="input-field"
                placeholder="Enter your name..."
                value={operatorName}
                onChange={e => setOperatorName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startRun()}
              />
            </div>
            <button onClick={startRun} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-base transition-colors">
              Start Process
            </button>
            <button onClick={() => navigate('/apps')} className="w-full py-2 text-sm text-gray-500 hover:text-gray-700">
              ← Back to Library
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Completed screen
  if (status === 'completed') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Process Complete!</h1>
          <p className="text-gray-500 mb-2">{app.name}</p>
          <p className="text-sm text-gray-400 mb-6">Completed by {operatorName || 'Operator'}</p>
          <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left space-y-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Step Times</div>
            {app.steps.map((step, i) => (
              <div key={step.id} className="flex justify-between text-sm">
                <span className="text-gray-600">{step.name}</span>
                <span className="font-medium text-gray-900">{stepTimes[i] ? `${stepTimes[i]}s` : '—'}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setStatus('setup'); setCurrentStepIdx(0); setFormData({}); setStepTimes({}); setCompletionId(null); }} className="btn-primary flex-1 justify-center">
              Run Again
            </button>
            <button onClick={() => navigate('/apps')} className="btn-secondary flex-1 justify-center">
              Back to Library
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Abandoned
  if (status === 'abandoned') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <X size={32} className="text-gray-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Process Abandoned</h1>
          <p className="text-gray-500 mb-6 text-sm">The process was stopped before completion.</p>
          <div className="flex gap-3">
            <button onClick={() => { setStatus('setup'); setCurrentStepIdx(0); setFormData({}); setStepTimes({}); setCompletionId(null); }} className="btn-primary flex-1 justify-center">
              Start Over
            </button>
            <button onClick={() => navigate('/apps')} className="btn-secondary flex-1 justify-center">
              Exit
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentStep = app.steps[currentStepIdx];
  const progress = ((currentStepIdx + 1) / app.steps.length) * 100;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Factory size={16} className="text-white" />
          </div>
          <div>
            <div className="text-white font-semibold text-sm">{app.name}</div>
            <div className="text-gray-400 text-xs">{operatorName || 'Operator'}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-white font-bold">{currentStepIdx + 1} / {app.steps.length}</div>
            <div className="text-gray-400 text-xs">Steps</div>
          </div>
          <button
            onClick={() => { if (confirm('Stop and abandon this process?')) abandon(); }}
            className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-red-400 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-800">
        <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      {/* Step tabs */}
      <div className="bg-gray-900 border-b border-gray-800 flex items-center gap-0.5 px-4 py-2 overflow-x-auto">
        {app.steps.map((step, idx) => (
          <div
            key={step.id}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              idx === currentStepIdx
                ? 'bg-blue-600 text-white'
                : idx < currentStepIdx
                ? 'text-green-400'
                : 'text-gray-500'
            }`}
          >
            {idx < currentStepIdx ? (
              <CheckCircle size={11} />
            ) : (
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-xs border ${
                idx === currentStepIdx ? 'border-white bg-white text-blue-600' : 'border-gray-600 text-gray-600'
              }`}>{idx + 1}</span>
            )}
            {step.name}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto flex justify-center py-8 px-4">
        <div className="w-full max-w-2xl space-y-4">
          <h2 className="text-2xl font-bold text-white mb-6">{currentStep.name}</h2>
          {currentStep.widgets.map(widget => (
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
          ))}
        </div>
      </div>

      {/* Footer nav */}
      <div className="bg-gray-900 border-t border-gray-800 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <button
          onClick={goPrev}
          disabled={currentStepIdx === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={16} /> Previous
        </button>
        <div className="text-gray-400 text-xs">
          <Clock size={12} className="inline mr-1" />
          Step {currentStepIdx + 1} of {app.steps.length}
        </div>
        {currentStepIdx < app.steps.length - 1 ? (
          <button
            onClick={goNext}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Next <ChevronRight size={16} />
          </button>
        ) : (
          <button
            onClick={complete}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <CheckCircle size={16} /> Complete
          </button>
        )}
      </div>
    </div>
  );
}

function PlayerWidget({ widget, value, onChange, onNext, onPrev, onComplete, isLastStep, isFirstStep }: {
  widget: Widget;
  value: any;
  onChange: (v: any) => void;
  onNext: () => void;
  onPrev: () => void;
  onComplete: () => void;
  isLastStep: boolean;
  isFirstStep: boolean;
}) {
  const { config } = widget;
  const [timerRunning, setTimerRunning] = useState(!!config.autoStart);
  const [timerLeft, setTimerLeft] = useState(config.duration || 60);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [counterVal, setCounterVal] = useState<number>(config.initialValue ?? 0);
  const [sigDrawing, setSigDrawing] = useState(false);

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

  const baseInput = "w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base";

  switch (widget.type) {
    case 'text':
      return (
        <p className="text-gray-200 leading-relaxed" style={{ fontSize: config.fontSize || 16, fontWeight: config.fontWeight || 'normal', color: config.color || '#e5e7eb' }}>
          {config.text}
        </p>
      );

    case 'instruction':
      return (
        <div className="rounded-xl p-5 border border-gray-700" style={{ backgroundColor: config.backgroundColor ? `${config.backgroundColor}22` : '#1e3a5f' }}>
          <div className="text-gray-100 text-sm leading-relaxed whitespace-pre-wrap">{config.content}</div>
        </div>
      );

    case 'separator':
      return <div className="border-t border-gray-800 my-2" />;

    case 'image':
      return config.imageUrl ? (
        <img src={config.imageUrl} alt={config.imageAlt || ''} className="w-full rounded-xl max-h-64 object-contain bg-gray-800 p-2" />
      ) : (
        <div className="w-full h-32 bg-gray-800 rounded-xl flex items-center justify-center text-gray-600 text-sm border border-dashed border-gray-700">Image placeholder</div>
      );

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
          {widget.label && <label className="block text-sm font-medium text-gray-300 mb-2">{widget.label}</label>}
          <div className="flex flex-wrap gap-2">
            {(config.options || []).map(opt => (
              <button
                key={opt}
                onClick={() => onChange(opt)}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all border-2 ${
                  value === opt
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      );

    case 'checkbox':
      return (
        <label className="flex items-center gap-4 cursor-pointer p-4 bg-gray-800 rounded-xl hover:bg-gray-750 transition-colors border border-gray-700 hover:border-gray-600">
          <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
            value ? 'bg-blue-600 border-blue-500' : 'border-gray-600'
          }`} onClick={() => onChange(!value)}>
            {value && <CheckCircle size={14} className="text-white" />}
          </div>
          <span className="text-gray-200 font-medium">{widget.label}</span>
        </label>
      );

    case 'timer': {
      const pct = (timerLeft / (config.duration || 60)) * 100;
      return (
        <div className="bg-gray-800 rounded-xl p-6 text-center border border-gray-700">
          {widget.label && <div className="text-gray-400 text-sm mb-3 font-medium">{widget.label}</div>}
          <div className="text-5xl font-mono font-bold text-white mb-4">
            {String(Math.floor(timerLeft / 60)).padStart(2, '0')}:{String(timerLeft % 60).padStart(2, '0')}
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-4">
            <div className={`h-full rounded-full transition-all ${timerLeft < 30 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex gap-2 justify-center">
            <button onClick={() => setTimerRunning(!timerRunning)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${timerRunning ? 'bg-yellow-600 hover:bg-yellow-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
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
            <button onClick={() => handleCounter(-1)} disabled={counterVal <= (config.min ?? 0)} className="w-14 h-14 rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-2xl font-bold transition-colors disabled:opacity-40 flex-shrink-0">−</button>
            <div className="text-center">
              <div className="text-5xl font-mono font-bold text-white">{counterVal}</div>
              <div className="text-gray-500 text-xs mt-1">{config.min ?? 0} — {config.max ?? '∞'}</div>
            </div>
            <button onClick={() => handleCounter(1)} disabled={counterVal >= (config.max ?? 9999)} className="w-14 h-14 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-2xl font-bold transition-colors disabled:opacity-40 flex-shrink-0">+</button>
          </div>
        </div>
      );

    case 'pass-fail':
      return (
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          {widget.label && <div className="text-gray-300 font-medium mb-4">{widget.label}</div>}
          <div className="flex gap-3">
            <button
              onClick={() => onChange('Pass')}
              className={`flex-1 py-4 rounded-xl text-base font-bold transition-all border-2 ${
                value === 'Pass'
                  ? 'bg-green-600 border-green-500 text-white'
                  : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-green-700 hover:text-green-400'
              }`}
            >
              ✓ Pass
            </button>
            <button
              onClick={() => onChange('Fail')}
              className={`flex-1 py-4 rounded-xl text-base font-bold transition-all border-2 ${
                value === 'Fail'
                  ? 'bg-red-600 border-red-500 text-white'
                  : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-red-700 hover:text-red-400'
              }`}
            >
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
              <button onClick={() => onChange('')} className="text-xs text-gray-500 hover:text-red-400">Clear signature</button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="h-16 bg-gray-900 rounded-lg border border-dashed border-gray-600 flex items-center justify-center text-gray-600 text-sm">Signature area</div>
              <input
                className={`${baseInput} text-center italic`}
                style={{ fontFamily: 'cursive' }}
                placeholder="Type your signature..."
                onBlur={e => e.target.value && onChange(e.target.value)}
              />
            </div>
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
        <button
          onClick={handleClick}
          className={`w-full ${sizeClass} rounded-xl font-semibold text-white transition-all hover:opacity-90 active:scale-95`}
          style={{ backgroundColor: config.buttonColor || '#3b82f6' }}
        >
          {config.buttonText || 'Next'}
        </button>
      );
    }

    default:
      return null;
  }
}

// Starting points for a new app, shown inline on the App Library instead of
// hiding behind a modal. Picking one opens the existing TemplatePickerModal
// with that choice preselected, so the naming step and plan-limit handling
// stay exactly where they already were.

import { useEffect, useState } from 'react';
import { AlertTriangle, FilePlus2, Layers, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { api } from '../../api/client';
import type { AppTemplatesResponse } from '../../api/client';

/** Matches TemplatePickerModal's Selection shape. */
export type TemplateChoice =
  | { kind: 'blank' }
  | { kind: 'built_in'; key: string }
  | { kind: 'mine'; id: string };

interface Props {
  /** Called with the picked starting point and its name (for prefilling). */
  onPick: (choice: TemplateChoice, name?: string) => void;
  /** Bigger, more inviting cards for the first-run hero. */
  emphasis?: boolean;
  className?: string;
}

export default function TemplateGallery({ onPick, emphasis = false, className = '' }: Props) {
  const [templates, setTemplates] = useState<AppTemplatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api.getAppTemplates()
      .then(setTemplates)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load templates'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 ${className}`}>
        {[1, 2, 3].map(i => <div key={i} className="h-32 rounded-xl animate-pulse bg-gray-100" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-xl border border-dashed border-gray-200 p-5 text-center ${className}`}>
        <AlertTriangle size={20} className="mx-auto mb-2 text-amber-500" />
        <p className="text-sm text-gray-500">{error}</p>
        <button onClick={load} className="btn-secondary mt-3 mx-auto">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  const builtIn = templates?.built_in ?? [];
  const mine = templates?.mine ?? [];
  const pad = emphasis ? 'p-5' : 'p-4';

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {builtIn.map(t => (
          <button
            key={t.key}
            onClick={() => onPick({ kind: 'built_in', key: t.key }, t.name)}
            className={`group text-left rounded-xl border border-gray-200 bg-white ${pad} transition-all hover:border-gray-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1`}
          >
            <div className="flex items-start justify-between gap-2">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-white flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}
              >
                <Wand2 size={17} />
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 flex-shrink-0">
                <Sparkles size={9} /> HartMonitor
              </span>
            </div>
            <h4 className="font-semibold text-gray-900 text-sm mt-3">{t.name}</h4>
            <p className={`text-xs text-gray-500 mt-1 leading-relaxed ${emphasis ? '' : 'line-clamp-2'}`}>
              {t.description}
            </p>
            <p className="text-[11px] text-gray-400 mt-2.5 flex items-center gap-1">
              <Layers size={11} /> {t.step_count} {t.step_count === 1 ? 'step' : 'steps'} · ready to edit
            </p>
          </button>
        ))}

        <button
          onClick={() => onPick({ kind: 'blank' })}
          className={`group text-left rounded-xl border border-dashed border-gray-300 bg-gray-50/60 ${pad} transition-all hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1`}
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-white border border-gray-200 text-gray-400">
            <FilePlus2 size={17} />
          </div>
          <h4 className="font-semibold text-gray-900 text-sm mt-3">Blank app</h4>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">
            One empty step. Best when your process does not look like anything above.
          </p>
          <p className="text-[11px] text-gray-400 mt-2.5 flex items-center gap-1">
            <Layers size={11} /> Start from nothing
          </p>
        </button>
      </div>

      {mine.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Your saved templates</h4>
          <div className="flex flex-wrap gap-2">
            {mine.map(t => (
              <button
                key={t.id}
                onClick={() => onPick({ kind: 'mine', id: t.id }, t.name)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition-colors hover:border-gray-300 hover:bg-gray-50"
              >
                <Layers size={13} className="text-gray-400" />
                <span className="text-[13px] font-medium text-gray-800">{t.name}</span>
                <span className="text-[11px] text-gray-400">{t.step_count} {t.step_count === 1 ? 'step' : 'steps'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

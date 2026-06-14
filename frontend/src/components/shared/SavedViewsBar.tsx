import { useState } from 'react';
import { Bookmark, Plus, X, Check } from 'lucide-react';
import { useSavedViews } from '../../hooks/useSavedViews';

export default function SavedViewsBar<T>({ storageKey, currentFilters, onApply }: {
  storageKey: string;
  currentFilters: T;
  onApply: (filters: T) => void;
}) {
  const { views, saveView, deleteView } = useSavedViews<T>(storageKey);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveView(trimmed, currentFilters);
    setName('');
    setAdding(false);
  };

  if (views.length === 0 && !adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0"
        title="Save the current filters as a view you can reuse later"
      >
        <Bookmark size={13} />
        Save view
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {views.map(v => (
        <span
          key={v.id}
          className="group inline-flex items-center gap-1 pl-2.5 pr-1 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
        >
          <button onClick={() => onApply(v.filters)} className="flex items-center gap-1">
            <Bookmark size={12} />
            {v.name}
          </button>
          <button
            onClick={() => deleteView(v.id)}
            className="p-0.5 rounded-full text-gray-400 hover:text-red-500 hover:bg-white transition-colors opacity-0 group-hover:opacity-100"
            title="Delete saved view"
          >
            <X size={11} />
          </button>
        </span>
      ))}

      {adding ? (
        <span className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg bg-white border border-gray-200 shadow-sm">
          <input
            autoFocus
            className="text-xs w-28 focus:outline-none"
            placeholder="View name…"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') { setAdding(false); setName(''); }
            }}
          />
          <button onClick={handleSave} className="p-1 rounded text-green-600 hover:bg-green-50" title="Save">
            <Check size={13} />
          </button>
          <button onClick={() => { setAdding(false); setName(''); }} className="p-1 rounded text-gray-400 hover:bg-gray-100" title="Cancel">
            <X size={13} />
          </button>
        </span>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          title="Save the current filters as a view"
        >
          <Plus size={13} />
          Save view
        </button>
      )}
    </div>
  );
}

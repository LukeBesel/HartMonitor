// ─── Which workspaces the plant shows, and what this device shows of them ────
//
// The old Navigation tab did two different jobs under one heading, and only
// one of them was ever anybody's to do. Turning a whole workspace off changes
// the sidebar for EVERY person in the company — that is plant configuration,
// it now lives in org_settings, and it belongs with the rest of the company's
// settings behind the manager gate. Hiding a single item, or reordering one,
// changes nothing for anybody else: it is this device's own copy, it was open
// to every role, and taking it away from operators to tidy the tab strip would
// have been a real loss for the people who use the fewest screens. So it moved
// to My Account instead, where the other "just me" settings live.
import Toggle from '../../components/shared/Toggle';
import { useState } from 'react';
import { Check, RotateCcw, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavPrefs } from '../../context/NavPrefsContext';
import { SECTIONS } from '../../config/navigation';
import { SectionHeader } from './shared';

// ─── Company-wide: which workspaces exist for everyone here (manager+) ───────

export function NavigationTab() {
  const { isSectionHidden, toggleSection, resetWorkspaces, sectionsError } = useNavPrefs();

  const confirmReset = () => {
    // This is not "reset my sidebar" any more — it turns every workspace back
    // on for every person in the company, which is not something to discover
    // afterwards.
    if (confirm('Show every workspace for everyone in the company?')) resetWorkspaces();
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <SectionHeader
          title="Workspaces"
          subtitle="Pick the areas this plant actually uses. Turn one off and it disappears from the sidebar for everyone in the company -- keeping things simple."
        />
        {/* A refused save has already put the switches back; say why rather
            than letting one flick itself off again with no explanation. */}
        {sectionsError && (
          <p className="mb-3 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
            {sectionsError}
          </p>
        )}
        <div className="grid sm:grid-cols-3 gap-3">
          {SECTIONS.map(section => {
            const on = !isSectionHidden(section.id);
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => toggleSection(section.id)}
                className={`text-left rounded-xl border-2 p-3.5 transition-all ${
                  on ? 'shadow-sm' : 'border-gray-100 opacity-70 hover:opacity-100'
                }`}
                style={on ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-light)' } : {}}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: on ? 'var(--accent)' : '#f1f5f9', color: on ? '#fff' : '#94a3b8' }}>
                    <Icon size={15} />
                  </div>
                  {on
                    ? <span style={{ color: 'var(--accent-ink)' }}><Check size={16} /></span>
                    : <span className="text-[10px] font-semibold text-gray-400 uppercase">Off</span>}
                </div>
                <div className="text-sm font-semibold text-gray-800">{section.label}</div>
                <div className="text-xs text-gray-500 mt-0.5 leading-snug">{section.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-100">
        <p className="text-xs text-gray-500">
          Command Center always stays visible. This choice is saved for the whole company --
          hiding items just for yourself is in My Account.
        </p>
        <button onClick={confirmReset} className="btn-secondary text-sm whitespace-nowrap flex items-center gap-1.5">
          <RotateCcw size={13} /> Reset to Defaults
        </button>
      </div>
    </div>
  );
}

// ─── This device: hide or reorder individual items (any role) ───────────────

export function MyNavigationTab() {
  const {
    isItemHidden, toggleItem,
    isSectionHidden,
    itemOrder, moveItem,
    resetMyNavPrefs,
  } = useNavPrefs();
  const { user } = useAuth();
  const isDeveloper = user?.role === 'developer';
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Apply the saved custom order to a section's items (matches the sidebar).
  const orderedItems = (section: typeof SECTIONS[number]) => {
    // Platform-staff items are not a customer's sidebar to arrange, and listing
    // one here would announce HartMonitor's operator console to everybody.
    const items = section.items.filter(i => !i.platformStaffOnly);
    const order = itemOrder[section.id];
    if (!order || order.length === 0) return items;
    return [...items].sort((a, b) => {
      const ia = order.indexOf(a.to); const ib = order.indexOf(b.to);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          {showAdvanced ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          Advanced -- show, hide{isDeveloper ? ', and reorder' : ''} individual items
        </button>
        {showAdvanced && (
          <div className="space-y-5 mt-3 pl-1">
            {isDeveloper && (
              <p className="text-xs text-gray-500">Use the arrows to reorder items within a section — the order is shared across your sidebar.</p>
            )}
            {SECTIONS.map(section => {
              const ordered = orderedItems(section);
              const orderPaths = ordered.map(i => i.to);
              return (
              <div key={section.id}>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">
                  <section.icon size={11} /> {section.label}
                </div>
                <div className="divide-y divide-gray-50">
                  {ordered.map((item, idx) => {
                    const Icon = item.icon;
                    const sectionOff = isSectionHidden(section.id);
                    return (
                      <div key={item.to} className="flex items-center justify-between py-2.5 gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isDeveloper && (
                            <div className="flex flex-col -my-1">
                              <button
                                onClick={() => moveItem(section.id, item.to, 'up', orderPaths)}
                                disabled={idx === 0}
                                className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300"
                                title="Move up"
                              >
                                <ChevronUp size={13} />
                              </button>
                              <button
                                onClick={() => moveItem(section.id, item.to, 'down', orderPaths)}
                                disabled={idx === ordered.length - 1}
                                className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300"
                                title="Move down"
                              >
                                <ChevronDown size={13} />
                              </button>
                            </div>
                          )}
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
                            <Icon size={14} />
                          </div>
                          <span className="text-sm font-medium text-gray-800 truncate">{item.label}</span>
                        </div>
                        <Toggle
                          checked={!sectionOff && !isItemHidden(item.to)}
                          onChange={() => toggleItem(item.to)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-100">
        <p className="text-xs text-gray-500">
          Command Center always stays visible. Nothing here leaves this device -- an item switched
          off is still there for everyone else.
        </p>
        <button onClick={resetMyNavPrefs} className="btn-secondary text-sm whitespace-nowrap flex items-center gap-1.5">
          <RotateCcw size={13} /> Reset My Sidebar
        </button>
      </div>
    </div>
  );
}

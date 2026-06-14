import { useState } from 'react';

const HIDDEN_KEY = 'hm_hidden_dashboard';

export type DashboardSectionId = 'attention' | 'kpis' | 'due_soon' | 'output' | 'quick_actions';

export const DASHBOARD_SECTIONS: { id: DashboardSectionId; label: string; description: string }[] = [
  { id: 'attention',     label: 'Needs Attention',  description: 'Overdue work orders, down stations, critical alerts' },
  { id: 'kpis',          label: 'Key Metrics',       description: 'Completed today, schedule adherence, pass rate, active now' },
  { id: 'due_soon',      label: 'Due in 48 Hours',   description: 'Work orders coming due soon' },
  { id: 'output',        label: 'Output Chart',      description: 'Completions over the last 7 days' },
  { id: 'quick_actions', label: 'Quick Actions',     description: 'Shortcuts to common tasks' },
];

function loadHidden(): Set<DashboardSectionId> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // ignore
  }
  return new Set();
}

function saveHidden(set: Set<DashboardSectionId>) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

export function useDashboardPrefs() {
  const [hidden, setHidden] = useState<Set<DashboardSectionId>>(() => loadHidden());

  const isHidden = (id: DashboardSectionId) => hidden.has(id);

  const toggleSection = (id: DashboardSectionId) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveHidden(next);
      return next;
    });
  };

  const resetSections = () => {
    setHidden(new Set());
    saveHidden(new Set());
  };

  return { isHidden, toggleSection, resetSections, hiddenCount: hidden.size };
}

import { useState } from 'react';

const HIDDEN_KEY = 'hm_hidden_dashboard';

export type DashboardSectionId =
  | 'attention' | 'kpis' | 'floor' | 'floor_departments' | 'floor_throughput'
  | 'floor_activity' | 'due_soon' | 'output';

export const DASHBOARD_SECTIONS: { id: DashboardSectionId; label: string; description: string }[] = [
  { id: 'attention',         label: 'Needs Attention',     description: 'Overdue work orders, down stations, critical alerts' },
  { id: 'kpis',              label: 'Key Metrics',          description: 'Completed today, schedule adherence, pass rate, active now' },
  { id: 'floor',             label: 'Live Floor View',      description: 'Real-time plant status section (master toggle)' },
  { id: 'floor_departments', label: '— Department Cards',   description: 'Live performance by department inside the floor view' },
  { id: 'floor_throughput',  label: '— Hourly Throughput',  description: 'Units-per-hour chart inside the floor view' },
  { id: 'floor_activity',    label: '— Alerts & Completions', description: 'Active alerts and recent completions inside the floor view' },
  { id: 'due_soon',          label: 'Due in 48 Hours',      description: 'Work orders coming due soon' },
  { id: 'output',            label: 'Output Chart',         description: 'Completions over the last 7 days' },
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

import { useState } from 'react';

const HIDDEN_KEY = 'hm_hidden_dashboard';

// `floor`, `floor_departments` and `floor_throughput` are retired ids from the
// old collapsible "Live Floor View". The department cards are now the way into
// the page, so hiding them would leave nothing to click, and the hourly chart
// became a range on the one Output card. The union keeps the old names so a
// preferences blob written by an earlier build still reads back cleanly.
export type DashboardSectionId =
  | 'attention' | 'kpis' | 'floor' | 'floor_departments' | 'floor_throughput'
  | 'floor_activity' | 'due_soon' | 'output';

// Listed in the order they appear on the page, so the panel reads as a map of it.
export const DASHBOARD_SECTIONS: { id: DashboardSectionId; label: string; description: string }[] = [
  { id: 'attention',      label: 'Needs Attention',   description: 'Overdue work orders, down stations, help requests' },
  { id: 'kpis',           label: 'Today at a Glance', description: 'Finished, running, average cycle time, pass rate' },
  { id: 'floor_activity', label: 'Latest Runs',       description: 'Each run as it lands, with the time it took' },
  { id: 'output',         label: 'Output Chart',      description: 'Runs finished over the last 24 hours or 7 days' },
  { id: 'due_soon',       label: 'Due in 48 Hours',   description: 'Work orders coming due, and schedule health' },
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

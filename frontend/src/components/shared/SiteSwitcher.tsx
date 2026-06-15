import { Building2 } from 'lucide-react';
import { useSite } from '../../context/SiteContext';
import { useAuth } from '../../context/AuthContext';

// Site/plant selector — exactly ONE site is always active (no "all sites" view).
export default function SiteSwitcher() {
  const { sites, selectedSiteId, setSelectedSiteId } = useSite();
  const { isAtLeast } = useAuth();

  const isManager = isAtLeast('manager');

  if (sites.length === 0) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/5 text-gray-500 text-[11px]">
        <Building2 size={11} className="flex-shrink-0" />
        <span>No facility set</span>
      </div>
    );
  }

  // A single site, or a non-manager: just show the active site as a static chip.
  if (sites.length === 1 || !isManager) {
    const active = sites.find(s => s.id === selectedSiteId) ?? sites[0];
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/5 text-gray-400 text-[11px] font-medium">
        <Building2 size={11} className="flex-shrink-0 text-blue-400" />
        <span className="truncate">{active.name}</span>
      </div>
    );
  }

  // Managers+ with multiple sites can switch between them — one at a time.
  return (
    <div className="relative">
      <Building2 size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
      <select
        value={selectedSiteId ?? sites[0].id}
        onChange={e => setSelectedSiteId(e.target.value)}
        className="w-full bg-white/5 text-gray-300 text-[11px] font-medium rounded-xl pl-7 pr-2 py-1.5 appearance-none cursor-pointer border border-white/5 hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus:ring-1 focus:ring-white/20"
      >
        {sites.map(site => (
          <option key={site.id} value={site.id} className="text-gray-900">{site.name}</option>
        ))}
      </select>
    </div>
  );
}

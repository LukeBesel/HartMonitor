import { Building2 } from 'lucide-react';
import { useSite } from '../../context/SiteContext';

export default function SiteSwitcher() {
  const { sites, selectedSiteId, setSelectedSiteId } = useSite();

  if (sites.length <= 1) return null;

  return (
    <div className="relative">
      <Building2 size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
      <select
        value={selectedSiteId ?? ''}
        onChange={e => setSelectedSiteId(e.target.value || null)}
        className="w-full bg-white/5 text-gray-300 text-[11px] font-medium rounded-xl pl-7 pr-2 py-1.5 appearance-none cursor-pointer border border-white/5 hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus:ring-1 focus:ring-white/20"
      >
        <option value="" className="text-gray-900">All Sites</option>
        {sites.map(site => (
          <option key={site.id} value={site.id} className="text-gray-900">{site.name}</option>
        ))}
      </select>
    </div>
  );
}

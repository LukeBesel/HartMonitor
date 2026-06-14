import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCircle2 } from 'lucide-react';
import { api } from '../../api/client';
import type { AttentionItem } from '../../types';
import { ATTENTION_ICONS, ATTENTION_TYPE_LABELS } from '../../config/attention';

export default function NotificationBell({ collapsed }: { collapsed: boolean }) {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => api.getDailyBrief().then(b => setItems(b.attention ?? [])).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const criticalCount = items.filter(i => i.severity === 'red').length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title={collapsed ? 'Alerts' : undefined}
        className={`relative flex items-center rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/8 transition-all w-full ${
          collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
        }`}
      >
        <Bell size={15} className="flex-shrink-0" />
        {!collapsed && <span className="flex-1 text-left">Alerts</span>}
        {items.length > 0 && (
          <span className={`flex items-center justify-center text-[10px] font-bold rounded-full text-white ${
            criticalCount > 0 ? 'bg-red-500' : 'bg-amber-500'
          } ${collapsed ? 'absolute top-0.5 right-0.5 w-4 h-4' : 'min-w-[18px] h-[18px] px-1'}`}>
            {items.length > 9 ? '9+' : items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-72 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50 max-h-96 overflow-y-auto">
          <div className="px-3 py-2.5 border-b border-gray-100 sticky top-0 bg-white">
            <div className="text-xs font-semibold text-gray-800">Needs Attention</div>
          </div>
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-gray-400 flex flex-col items-center gap-2">
              <CheckCircle2 size={20} className="text-green-400" />
              All clear — nothing needs attention
            </div>
          ) : (
            items.map((item, i) => (
              <Link
                key={`${item.type}-${i}`}
                to={item.link}
                onClick={() => setOpen(false)}
                className="flex items-start gap-2.5 px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
              >
                <span className={`flex-shrink-0 mt-0.5 ${item.severity === 'red' ? 'text-red-500' : 'text-amber-500'}`}>
                  {ATTENTION_ICONS[item.type]}
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{ATTENTION_TYPE_LABELS[item.type]}</div>
                  <div className="text-xs font-medium text-gray-800 truncate">{item.label}</div>
                  {item.detail && <div className="text-[11px] text-gray-400 truncate">{item.detail}</div>}
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

import { X, Zap, Check, ArrowRight, Plus } from 'lucide-react';
import { usePlan } from '../../context/PlanContext';
import { api } from '../../api/client';
import { useState } from 'react';

interface Props {
  onClose: () => void;
  /** Which limit was hit — controls the à-la-carte offer shown */
  feature?: 'app' | 'dashboard';
  reason?: string;
  /** Called after a successful purchase/upgrade so the caller can retry */
  onPurchased?: () => void;
}

export default function UpgradeModal({ onClose, feature = 'app', reason, onPurchased }: Props) {
  const { plan, refresh } = usePlan();
  const [busy, setBusy] = useState<'slot' | 'pro' | null>(null);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  const addonType = feature === 'dashboard' ? 'dashboard_slot' : 'app_slot';
  const addon = plan?.pricing?.addons?.[addonType];
  const proPrice = plan?.pricing?.tiers?.pro?.monthly_price ?? 299;
  const proFeatures = plan?.pricing?.tiers?.pro?.features ?? [];

  const finish = (msg: string) => {
    refresh();
    setDone(msg);
    setTimeout(() => { onPurchased?.(); onClose(); }, 1200);
  };

  const buySlot = async () => {
    setBusy('slot');
    setError('');
    try {
      await api.purchaseAddon(addonType, 1);
      finish(`${addon?.name ?? 'Slot'} added — you can create it now!`);
    } catch (err: any) {
      setError(err.message || 'Purchase failed');
      setBusy(null);
    }
  };

  const upgradePro = async () => {
    setBusy('pro');
    setError('');
    try {
      await api.updatePlan({ tier: 'pro' });
      finish('Upgraded to Pro — unlimited everything!');
    } catch (err: any) {
      setError(err.message || 'Upgrade failed');
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 bg-gradient-to-br from-blue-600 to-blue-700 relative">
          <button onClick={onClose} className="absolute top-4 right-4 text-blue-200 hover:text-white transition-colors">
            <X size={18} />
          </button>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <div className="text-white font-bold text-lg leading-tight">
                {feature === 'dashboard' ? 'Dashboard limit reached' : 'App limit reached'}
              </div>
              <div className="text-blue-200 text-xs">Add capacity your way</div>
            </div>
          </div>
          {reason && (
            <div className="text-sm text-blue-100 bg-blue-800/30 rounded-lg px-3 py-2">{reason}</div>
          )}
        </div>

        {done ? (
          <div className="px-6 py-10 text-center">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
              <Check size={22} className="text-green-600" />
            </div>
            <p className="text-sm font-semibold text-gray-800">{done}</p>
          </div>
        ) : (
          <>
            {/* Option 1: à-la-carte slot */}
            {addon && (
              <div className="px-6 pt-5">
                <button
                  onClick={buySlot}
                  disabled={!!busy}
                  className="w-full rounded-xl border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all p-4 text-left flex items-center justify-between gap-3 disabled:opacity-60"
                >
                  <div>
                    <div className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                      <Plus size={14} className="text-blue-600" /> Add 1 {addon.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{addon.description}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-gray-900">${addon.monthly_price}<span className="text-xs font-normal text-gray-500">/mo</span></div>
                    {busy === 'slot' && <div className="text-[10px] text-blue-500">Processing…</div>}
                  </div>
                </button>
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">or go unlimited</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
              </div>
            )}

            {/* Option 2: Pro */}
            <div className="px-6">
              <div className="rounded-xl border-2 p-4" style={{ borderColor: 'var(--accent)' }}>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="text-sm font-bold text-gray-800 flex items-center gap-1.5">✦ Pro Plan</div>
                  <div className="font-bold text-gray-900">${proPrice}<span className="text-xs font-normal text-gray-500">/mo</span></div>
                </div>
                <ul className="space-y-1.5 mb-3">
                  {proFeatures.slice(0, 5).map(f => (
                    <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
                      <Check size={11} className="text-green-600 flex-shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={upgradePro}
                  disabled={!!busy}
                  className="w-full py-2.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))' }}
                >
                  {busy === 'pro' ? 'Upgrading…' : <>Upgrade to Pro <ArrowRight size={14} /></>}
                </button>
              </div>
            </div>

            <div className="px-6 pb-5 pt-3 space-y-1">
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button onClick={onClose} className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                Maybe later
              </button>
              <p className="text-center text-xs text-gray-400">Demo checkout — purchases are instant and free.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

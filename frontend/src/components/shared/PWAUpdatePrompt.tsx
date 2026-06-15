import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

// Uses the vite-plugin-pwa virtual module to listen for service-worker updates.
// When a new version is deployed, a non-intrusive banner appears at the bottom
// of the screen so users can reload to get the latest code.
export default function PWAUpdatePrompt() {
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Listen for the controlling SW to change — that's when an update has been
    // applied and the page needs a reload to use the new version.
    navigator.serviceWorker.ready.then(reg => {
      setRegistration(reg);

      // The SW can signal us via postMessage when it has finished installing.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        setNeedsUpdate(true);
      });

      // Also watch for an updatefound event — new SW is installing.
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            setNeedsUpdate(true);
          }
        });
      });
    });
  }, []);

  function reload() {
    // Tell the waiting SW to take control, then reload the page.
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  }

  if (!needsUpdate || dismissed) return null;

  return (
    <div className="fixed bottom-24 right-4 z-50 max-w-sm w-full animate-slide-up">
      <div className="bg-gray-900 text-white rounded-2xl shadow-2xl border border-white/10 px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
          <RefreshCw size={15} className="text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Update available</p>
          <p className="text-xs text-gray-400">Refresh to get the latest version.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={reload}
            className="text-xs font-semibold px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
          >
            Refresh
          </button>
          <button onClick={() => setDismissed(true)} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

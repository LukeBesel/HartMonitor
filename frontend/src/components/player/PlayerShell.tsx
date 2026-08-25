import type { ReactNode } from 'react';
import { Info, AlertTriangle, XCircle } from 'lucide-react';

export interface PlayerToast {
  id: string;
  level: 'info' | 'warning' | 'error';
  text: string;
}

/** Full-screen dark shell (spec §5.1): header on top, step canvas in a scroll
 *  region, footer pinned at the bottom, block banner between header and canvas,
 *  toast stack floating bottom-right. The `.dark`/`data-player` mount is owned
 *  by AppPlayer (it spans setup and summary screens too). */
export default function PlayerShell({ header, banner, footer, summaryBar, toasts, onDismissToast, children }: {
  header: ReactNode;
  banner?: ReactNode;
  footer: ReactNode;
  /** Pinned above the footer (kit summary bar, spec §5.4). */
  summaryBar?: ReactNode;
  toasts: PlayerToast[];
  onDismissToast: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="p-root p-root-run" data-player-shell>
      {header}
      {banner}
      <main className="p-main flex-1 overflow-y-auto flex justify-center px-4 py-4 sm:py-8">
        {children}
      </main>
      {summaryBar}
      {footer}

      {/* Toast stack */}
      {toasts.length > 0 && (
        <div className="fixed bottom-24 left-4 right-4 sm:left-auto z-[65] flex flex-col gap-2 items-end">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`p-toast p-toast-${t.level}`}
              role="status"
              onClick={() => onDismissToast(t.id)}
            >
              {t.level === 'info' && <Info size={17} className="flex-shrink-0 mt-0.5" />}
              {t.level === 'warning' && <AlertTriangle size={17} className="flex-shrink-0 mt-0.5" />}
              {t.level === 'error' && <XCircle size={17} className="flex-shrink-0 mt-0.5" />}
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

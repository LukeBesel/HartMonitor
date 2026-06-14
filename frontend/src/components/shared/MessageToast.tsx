import { useEffect } from 'react';
import { MessageSquare, AlertTriangle, Siren, X } from 'lucide-react';
import { useMessages } from '../../context/MessagesContext';
import type { MessageSeverity } from '../../types';

const SEVERITY_STYLES: Record<MessageSeverity, { icon: React.ElementType; classes: string; iconClasses: string }> = {
  info:    { icon: MessageSquare, classes: 'bg-blue-50 border-blue-200 text-blue-900',     iconClasses: 'text-blue-500' },
  warning: { icon: AlertTriangle, classes: 'bg-amber-50 border-amber-200 text-amber-900',  iconClasses: 'text-amber-500' },
  urgent:  { icon: Siren,         classes: 'bg-red-50 border-red-200 text-red-900',        iconClasses: 'text-red-500' },
};

const AUTO_DISMISS_MS = 8000;

export default function MessageToast() {
  const { toast, dismissToast } = useMessages();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismissToast, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);

  if (!toast) return null;

  const style = SEVERITY_STYLES[toast.severity] ?? SEVERITY_STYLES.info;
  const Icon = style.icon;

  return (
    <div className="fixed top-3 inset-x-0 z-[100] flex justify-center px-3 pointer-events-none">
      <div className={`pointer-events-auto w-full max-w-md rounded-xl border shadow-lg px-4 py-3 flex items-start gap-3 ${style.classes}`}>
        <Icon size={18} className={`flex-shrink-0 mt-0.5 ${style.iconClasses}`} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold truncate">{toast.sender_name}</div>
          <div className="text-sm break-words">{toast.body}</div>
        </div>
        <button onClick={dismissToast} className="flex-shrink-0 text-current opacity-50 hover:opacity-90 transition-opacity">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

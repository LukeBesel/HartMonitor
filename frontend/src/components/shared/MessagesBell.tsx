import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Send, Wifi, WifiOff } from 'lucide-react';
import { useMessages } from '../../context/MessagesContext';
import { useAuth } from '../../context/AuthContext';
import { timeAgo } from '../../utils/time';
import type { MessageSeverity } from '../../types';

const SEVERITY_DOT: Record<MessageSeverity, string> = {
  info: 'bg-blue-400',
  warning: 'bg-amber-400',
  urgent: 'bg-red-400',
};

const DROPDOWN_WIDTH = 320;

export default function MessagesBell({ collapsed }: { collapsed: boolean }) {
  const { messages, unreadCount, connected, markAllRead, sendMessage } = useMessages();
  const { isAtLeast } = useAuth();
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<MessageSeverity>('info');
  const [sending, setSending] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
      setComposing(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggleOpen = () => {
    setOpen(o => {
      const next = !o;
      if (next) {
        markAllRead();
        const rect = buttonRef.current?.getBoundingClientRect();
        if (rect) {
          const left = Math.min(rect.left, window.innerWidth - DROPDOWN_WIDTH - 8);
          setPos({ left: Math.max(8, left), bottom: window.innerHeight - rect.top + 4 });
        }
      } else {
        setComposing(false);
      }
      return next;
    });
  };

  const handleSend = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      await sendMessage(body.trim(), severity);
      setBody('');
      setSeverity('info');
      setComposing(false);
    } catch {
      // ignore — user can retry
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        title={collapsed ? 'Messages' : undefined}
        className={`relative flex items-center rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/8 transition-all w-full ${
          collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
        }`}
      >
        <MessageSquare size={15} className="flex-shrink-0" />
        {!collapsed && <span className="flex-1 text-left">Messages</span>}
        {unreadCount > 0 && (
          <span className={`flex items-center justify-center text-[10px] font-bold rounded-full text-white bg-blue-500 ${
            collapsed ? 'absolute top-0.5 right-0.5 w-4 h-4' : 'min-w-[18px] h-[18px] px-1'
          }`}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, width: DROPDOWN_WIDTH }}
          className="bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50 max-h-[28rem] flex flex-col"
        >
          <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <div className="text-xs font-semibold text-gray-800">Messages</div>
              {connected ? <Wifi size={11} className="text-green-500" /> : <WifiOff size={11} className="text-gray-400" />}
            </div>
            {isAtLeast('supervisor') && (
              <button
                onClick={() => setComposing(c => !c)}
                className="text-[11px] font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                {composing ? 'Cancel' : 'New message'}
              </button>
            )}
          </div>

          {composing && (
            <div className="px-3 py-2.5 border-b border-gray-100 flex-shrink-0 space-y-2">
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Message everyone on shift..."
                rows={3}
                maxLength={500}
                className="w-full text-sm rounded-lg border border-gray-200 px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none text-gray-900"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {(['info', 'warning', 'urgent'] as MessageSeverity[]).map(s => (
                    <button
                      key={s}
                      onClick={() => setSeverity(s)}
                      className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-md border transition-colors ${
                        severity === s
                          ? s === 'info' ? 'bg-blue-50 border-blue-300 text-blue-700'
                          : s === 'warning' ? 'bg-amber-50 border-amber-300 text-amber-700'
                          : 'bg-red-50 border-red-300 text-red-700'
                          : 'border-gray-200 text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleSend}
                  disabled={!body.trim() || sending}
                  className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  <Send size={12} />
                  Send
                </button>
              </div>
            </div>
          )}

          <div className="overflow-y-auto flex-1">
            {messages.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-400">No messages yet</div>
            ) : (
              messages.map(m => (
                <div key={m.id} className="px-3 py-2.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOT[m.severity] ?? SEVERITY_DOT.info}`} />
                    <span className="text-xs font-semibold text-gray-800 truncate">{m.sender_name}</span>
                    <span className="text-[10px] text-gray-400 ml-auto flex-shrink-0">{timeAgo(m.created_at)}</span>
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5 break-words">{m.body}</div>
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

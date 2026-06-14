import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCircle2, Send, Wifi, WifiOff, Lock } from 'lucide-react';
import { api } from '../../api/client';
import { useMessages } from '../../context/MessagesContext';
import { useAuth } from '../../context/AuthContext';
import { timeAgo } from '../../utils/time';
import type { AttentionItem, MessageSeverity } from '../../types';
import { ATTENTION_ICONS, ATTENTION_TYPE_LABELS } from '../../config/attention';

const SEVERITY_DOT: Record<MessageSeverity, string> = {
  info: 'bg-blue-400',
  warning: 'bg-amber-400',
  urgent: 'bg-red-400',
};

const DROPDOWN_WIDTH = 340;

// A unified feed row — either a live "needs attention" alert or a team message.
type FeedRow =
  | { kind: 'alert'; key: string; rank: number; item: AttentionItem }
  | { kind: 'message'; key: string; rank: number; time: string; id: string;
      sender: string; body: string; severity: MessageSeverity;
      recipientId?: string | null; recipientName?: string | null; senderId: string };

// Combines the attention/alerts feed and team messaging into ONE merged,
// chronological list under a single sidebar entry — keeps the bottom-left compact.
export default function AlertsBell({ collapsed }: { collapsed: boolean }) {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const { messages, unreadCount, connected, markAllRead, sendMessage } = useMessages();
  const { user, isAtLeast } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<MessageSeverity>('info');
  const [recipientId, setRecipientId] = useState('');     // '' = everyone (broadcast)
  const [users, setUsers] = useState<{ id: string; display_name: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load the team list the first time the composer is opened (for direct messages).
  useEffect(() => {
    if (composing && users.length === 0) {
      api.getUsers().then(rows => setUsers(rows.filter((u: any) => u.id !== user?.id))).catch(() => {});
    }
  }, [composing, users.length, user?.id]);

  useEffect(() => {
    const load = () => api.getDailyBrief().then(b => setItems(b.attention ?? [])).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

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

  const criticalCount = items.filter(i => i.severity === 'red').length;
  const totalBadge = items.length + unreadCount;

  // Merge alerts + messages into one ranked feed. Alerts represent the current
  // state of the floor so they float to the top (red before amber); messages
  // follow, newest first.
  const feed = useMemo<FeedRow[]>(() => {
    const alertRows: FeedRow[] = items.map((item, i) => ({
      kind: 'alert',
      key: `a-${item.type}-${i}`,
      rank: item.severity === 'red' ? 0 : 1,
      item,
    }));
    const messageRows: FeedRow[] = messages.map(m => ({
      kind: 'message',
      key: `m-${m.id}`,
      rank: 2,
      time: m.created_at,
      id: m.id,
      sender: m.sender_name,
      body: m.body,
      severity: m.severity,
      recipientId: m.recipient_id,
      recipientName: m.recipient_name,
      senderId: m.sender_id,
    }));
    return [...alertRows, ...messageRows].sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.kind === 'message' && b.kind === 'message') return b.time.localeCompare(a.time);
      return 0;
    });
  }, [items, messages]);

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
      await sendMessage(body.trim(), severity, recipientId || null);
      setBody('');
      setSeverity('info');
      setRecipientId('');
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
        title={collapsed ? 'Alerts & Messages' : undefined}
        className={`relative flex items-center rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/8 transition-all w-full ${
          collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
        }`}
      >
        <Bell size={15} className="flex-shrink-0" />
        {!collapsed && <span className="flex-1 text-left">Alerts</span>}
        {totalBadge > 0 && (
          <span className={`flex items-center justify-center text-[10px] font-bold rounded-full text-white ${
            criticalCount > 0 ? 'bg-red-500' : unreadCount > 0 ? 'bg-blue-500' : 'bg-amber-500'
          } ${collapsed ? 'absolute top-0.5 right-0.5 w-4 h-4' : 'min-w-[18px] h-[18px] px-1'}`}>
            {totalBadge > 9 ? '9+' : totalBadge}
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
              <div className="text-xs font-semibold text-gray-800">Alerts &amp; Messages</div>
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
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-gray-400 flex-shrink-0">To:</span>
                <select
                  value={recipientId}
                  onChange={e => setRecipientId(e.target.value)}
                  className="flex-1 text-xs rounded-lg border border-gray-200 px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white"
                >
                  <option value="">Everyone (broadcast)</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.display_name}</option>
                  ))}
                </select>
              </div>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={recipientId ? 'Send a direct message…' : 'Message everyone on shift...'}
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
            {feed.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-gray-400 flex flex-col items-center gap-2">
                <CheckCircle2 size={20} className="text-green-400" />
                All clear — no alerts or messages
              </div>
            ) : (
              feed.map(row => row.kind === 'alert' ? (
                <button
                  key={row.key}
                  onClick={() => { setOpen(false); navigate(row.item.link); }}
                  className="w-full flex items-start gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <span className={`flex-shrink-0 mt-0.5 ${row.item.severity === 'red' ? 'text-red-500' : 'text-amber-500'}`}>
                    {ATTENTION_ICONS[row.item.type]}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{ATTENTION_TYPE_LABELS[row.item.type]}</div>
                    <div className="text-xs font-medium text-gray-800 truncate">{row.item.label}</div>
                    {row.item.detail && <div className="text-[11px] text-gray-400 truncate">{row.item.detail}</div>}
                  </div>
                </button>
              ) : (
                <div key={row.key} className={`px-3 py-2.5 border-b border-gray-50 last:border-0 ${row.recipientId ? 'bg-blue-50/40' : ''}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOT[row.severity] ?? SEVERITY_DOT.info}`} />
                    <span className="text-xs font-semibold text-gray-800 truncate">{row.sender}</span>
                    {row.recipientId && (
                      <span className="flex items-center gap-0.5 text-[10px] font-medium text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        <Lock size={8} />
                        {row.senderId === user?.id ? `to ${row.recipientName ?? 'you'}` : 'direct'}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-400 ml-auto flex-shrink-0">{timeAgo(row.time)}</span>
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5 break-words">{row.body}</div>
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

import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import type { BroadcastMessage, MessageSeverity } from '../types';

interface MessagesContextValue {
  messages: BroadcastMessage[];
  unreadCount: number;
  connected: boolean;
  markAllRead: () => void;
  sendMessage: (body: string, severity?: MessageSeverity) => Promise<void>;
  toast: BroadcastMessage | null;
  dismissToast: () => void;
}

const MessagesContext = createContext<MessagesContextValue | null>(null);

const MAX_HISTORY = 100;

export function MessagesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<BroadcastMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<BroadcastMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!user) {
      setMessages([]);
      setUnreadCount(0);
      return;
    }
    api.getMessages().then(setMessages).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('hm_token');
    if (!token) return;

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setConnected(true);
      };

      ws.onmessage = ev => {
        let data: any;
        try {
          data = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (data?.type !== 'message' || !data.message) return;
        const incoming: BroadcastMessage = data.message;
        setMessages(prev => prev.some(m => m.id === incoming.id) ? prev : [incoming, ...prev].slice(0, MAX_HISTORY));
        if (incoming.sender_id !== user.id) {
          setUnreadCount(c => c + 1);
          setToast(incoming);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (cancelled) return;
        const delay = Math.min(30000, 1000 * 2 ** reconnectAttemptsRef.current);
        reconnectAttemptsRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [user]);

  const markAllRead = useCallback(() => setUnreadCount(0), []);

  const sendMessage = useCallback(async (body: string, severity: MessageSeverity = 'info') => {
    const msg = await api.sendMessage(body, severity);
    setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [msg, ...prev].slice(0, MAX_HISTORY));
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  return (
    <MessagesContext.Provider value={{ messages, unreadCount, connected, markAllRead, sendMessage, toast, dismissToast }}>
      {children}
    </MessagesContext.Provider>
  );
}

export function useMessages(): MessagesContextValue {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error('useMessages must be used within a MessagesProvider');
  return ctx;
}

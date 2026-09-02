// ─── Notifications ──────────────────────────────────────────────────────────
import Toggle from '../../components/shared/Toggle';
import { useState, useEffect, useRef } from 'react';
import { Check, AlertCircle, Bell, Send, Mail, MessageSquare, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import type { NotificationPrefs, NotificationLogEntry } from '../../types';
import { SectionHeader, Toast } from './shared';

// ─── Tab 8: Notifications ─────────────────────────────────────────────────────

export function NotificationsTab() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saved, setSaved] = useState<NotificationPrefs | null>(null);
  const [log, setLog] = useState<NotificationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([api.getNotificationPrefs(), api.getNotificationLog(20)])
      .then(([p, l]) => {
        setPrefs(p);
        setSaved(p);
        setLog(l);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const isDirty = JSON.stringify(prefs) !== JSON.stringify(saved);

  const toggleEvent = (key: string) => {
    if (!prefs) return;
    const has = prefs.events.includes(key);
    setPrefs({ ...prefs, events: has ? prefs.events.filter(e => e !== key) : [...prefs.events, key] });
  };

  const handleSave = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const updated = await api.updateNotificationPrefs({
        email_enabled: prefs.email_enabled,
        email_to: prefs.email_to,
        sms_enabled: prefs.sms_enabled,
        sms_to: prefs.sms_to,
        events: prefs.events,
      });
      setPrefs(updated);
      setSaved(updated);
      showToast('Notification preferences saved');
    } catch (err: any) {
      showToast(err.message || 'Failed to save preferences', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result: any = await api.sendTestNotification();
      showToast(result?.message || 'Test notification sent');
      api.getNotificationLog(20).then(setLog).catch(() => {});
    } catch (err: any) {
      showToast(err.message || 'Failed to send test notification', 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading || !prefs) {
    return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading notification settings…</div>;
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Channel status */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 ${
          prefs.email_configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
        }`}>
          <Mail size={12} />
          {prefs.email_configured ? 'Email -- Configured' : 'Email -- Demo mode (will log instead of send)'}
        </span>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 ${
          prefs.sms_configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
        }`}>
          <MessageSquare size={12} />
          {prefs.sms_configured ? 'SMS -- Configured' : 'SMS -- Demo mode (will log instead of send)'}
        </span>
      </div>

      {/* Email */}
      <div>
        <SectionHeader title="Email Alerts" subtitle="Send email notifications for selected events" />
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-gray-800">Enable email notifications</div>
            </div>
            <Toggle checked={prefs.email_enabled} onChange={(v) => setPrefs(p => p ? { ...p, email_enabled: v } : p)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Recipients</label>
            <input
              className="input-field w-full"
              value={prefs.email_to}
              onChange={e => setPrefs(p => p ? { ...p, email_to: e.target.value } : p)}
              placeholder="ops@company.com, manager@company.com"
            />
            <p className="text-xs text-gray-400 mt-1">Comma-separated email addresses</p>
          </div>
        </div>
      </div>

      {/* SMS */}
      <div>
        <SectionHeader title="SMS Alerts" subtitle="Send text message notifications for selected events" />
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-gray-800">Enable SMS notifications</div>
            </div>
            <Toggle checked={prefs.sms_enabled} onChange={(v) => setPrefs(p => p ? { ...p, sms_enabled: v } : p)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Recipients</label>
            <input
              className="input-field w-full"
              value={prefs.sms_to}
              onChange={e => setPrefs(p => p ? { ...p, sms_to: e.target.value } : p)}
              placeholder="+15551234567"
            />
            <p className="text-xs text-gray-400 mt-1">Comma-separated phone numbers, e.g. +15551234567</p>
          </div>
        </div>
      </div>

      {/* Event subscriptions */}
      <div>
        <SectionHeader title="Event Subscriptions" subtitle="Choose which events trigger notifications" />
        <div className="divide-y divide-gray-50">
          {Object.entries(prefs.available_events).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between py-2.5 gap-4 cursor-pointer">
              <span className="text-sm text-gray-700">{label}</span>
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300"
                checked={prefs.events.includes(key)}
                onChange={() => toggleEvent(key)}
                style={{ accentColor: 'var(--accent)' }}
              />
            </label>
          ))}
        </div>
      </div>

      {/* Save / Test */}
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center justify-center gap-2">
          {saving ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Saving…</> : <><Check size={15} />Save</>}
        </button>
        <button onClick={handleTest} disabled={testing} className="btn-secondary flex items-center justify-center gap-2">
          {testing ? <><span className="w-4 h-4 border-2 border-current/40 border-t-current rounded-full animate-spin" />Sending…</> : <><Send size={14} />Send Test Notification</>}
        </button>
        {isDirty && (
          <span className="text-xs text-amber-600 whitespace-nowrap flex items-center gap-1">
            <AlertCircle size={12} /> Unsaved changes
          </span>
        )}
      </div>

      {/* Recent notifications */}
      <div>
        <SectionHeader title="Recent Notifications" subtitle="Last 20 notification attempts" />
        {log.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
            <Bell size={24} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">No notifications sent yet</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
            {/* The table scrolls inside itself: several of these columns do not fit
                a phone, and the rounded card around it clipped them off entirely. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Event</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Channel</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Recipient</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Status</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {log.map(entry => (
                    <tr key={entry.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 text-gray-700">{prefs.available_events[entry.event] ?? entry.event}</td>
                      <td className="px-4 py-2.5 text-gray-500">
                        <span className="inline-flex items-center gap-1.5">
                          {entry.channel === 'email' ? <Mail size={12} /> : <MessageSquare size={12} />}
                          {entry.channel.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{entry.recipient}</td>
                      <td className="px-4 py-2.5 text-center">
                        {entry.status === 'sent' && (
                          <span title="Sent" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                            <CheckCircle2 size={14} /> Sent
                          </span>
                        )}
                        {entry.status === 'simulated' && (
                          <span title="Demo mode -- logged instead of sent" className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                            <AlertCircle size={14} /> Simulated
                          </span>
                        )}
                        {entry.status === 'failed' && (
                          <span title="Failed to send" className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
                            <XCircle size={14} /> Failed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                        {new Date(entry.created_at + 'Z').toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

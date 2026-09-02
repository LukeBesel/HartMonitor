// ─── API keys and outbound webhooks ─────────────────────────────────────────
import { useState, useEffect, useRef } from 'react';
import { Activity, AlertCircle, Plus, Trash2, Edit2, X, Key, Copy, Send, CheckCircle2, XCircle, Crown, Code, Webhook as WebhookIcon } from 'lucide-react';
import { api } from '../../api/client';
import type { ApiKey, Webhook, WebhookDelivery } from '../../types';
import { SectionHeader, Toast } from './shared';

// ─── API keys and webhooks (Enterprise) ───────────────────────────────────────

function NewApiKeyModal({ onClose, onCreated, onError }: {
  onClose: () => void;
  onCreated: (key: ApiKey & { key: string }) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      const created = await api.createApiKey(name.trim());
      onCreated(created);
    } catch (err: any) {
      setError(err.message || 'Failed to create API key');
      onError(err.message || 'Failed to create API key');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Generate New API Key</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
            <input className="input-field w-full" value={name} onChange={e => setName(e.target.value)} required placeholder="ERP Integration" />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Generating…' : 'Generate Key'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RevealKeyModal({ apiKey, onClose }: { apiKey: ApiKey & { key: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">API Key Created</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-2.5 text-xs bg-amber-50 text-amber-800 rounded-xl px-3.5 py-2.5 border border-amber-100">
            <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
            <span>This key will only be shown once -- copy it now. You won't be able to view it again.</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{apiKey.name}</label>
            <div className="flex items-center gap-2">
              <code className="input-field w-full font-mono text-xs break-all">{apiKey.key}</code>
              <button onClick={handleCopy} type="button" className="btn-secondary flex-shrink-0 px-3 py-2.5 flex items-center gap-1.5 text-xs">
                <Copy size={13} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <button onClick={onClose} className="btn-primary w-full">Done</button>
        </div>
      </div>
    </div>
  );
}

function WebhookModal({ webhook, availableEvents, onClose, onSaved, onError }: {
  webhook: Webhook | null;
  availableEvents: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const isEdit = !!webhook;
  const [name, setName] = useState(webhook?.name ?? '');
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [events, setEvents] = useState<string[]>(webhook?.events ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleEvent = (key: string) => {
    if (key === '*') {
      setEvents(prev => prev.includes('*') ? [] : ['*']);
      return;
    }
    setEvents(prev => {
      const withoutAll = prev.filter(e => e !== '*');
      return withoutAll.includes(key) ? withoutAll.filter(e => e !== key) : [...withoutAll, key];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if (!url.trim()) { setError('URL is required'); return; }
    if (events.length === 0) { setError('Select at least one event'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api.updateWebhook(webhook!.id, { name, url, events });
        onSaved('Webhook updated');
      } else {
        await api.createWebhook({ name, url, events });
        onSaved('Webhook created');
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save webhook');
      onError(err.message || 'Failed to save webhook');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-800">{isEdit ? 'Edit Webhook' : 'Add Webhook'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
            <input className="input-field w-full" value={name} onChange={e => setName(e.target.value)} required placeholder="ERP Sync" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">URL</label>
            <input type="url" className="input-field w-full" value={url} onChange={e => setUrl(e.target.value)} required placeholder="https://example.com/webhooks/hartmonitor" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Events</label>
            <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg max-h-56 overflow-y-auto">
              {availableEvents.map(key => (
                <label key={key} className="flex items-center justify-between py-2 px-3 gap-4 cursor-pointer text-sm">
                  <span className="text-gray-700">{key === '*' ? 'All events' : key}</span>
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300"
                    checked={events.includes(key) || (key !== '*' && events.includes('*'))}
                    onChange={() => toggleEvent(key)}
                    disabled={key !== '*' && events.includes('*')}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Webhook'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function WebhookDeliveriesModal({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getWebhookDeliveries(webhook.id)
      .then(setDeliveries)
      .catch(() => setDeliveries([]))
      .finally(() => setLoading(false));
  }, [webhook.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-800">Deliveries -- {webhook.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">Loading deliveries…</div>
          ) : deliveries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
              <p className="text-sm text-gray-400">No deliveries yet</p>
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
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Status</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Result</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Error</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {deliveries.map(d => (
                      <tr key={d.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 text-gray-700">{d.event}</td>
                        <td className="px-4 py-2.5 text-center text-gray-600">{d.status_code ?? '--'}</td>
                        <td className="px-4 py-2.5 text-center">
                          {d.success
                            ? <CheckCircle2 size={14} className="text-emerald-500 inline" />
                            : <XCircle size={14} className="text-red-500 inline" />}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{d.error || '--'}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                          {new Date(d.created_at + 'Z').toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


export function ApiTab() {
  const [availability, setAvailability] = useState<{ available: boolean; events: string[] } | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewKey, setShowNewKey] = useState(false);
  const [revealKey, setRevealKey] = useState<(ApiKey & { key: string }) | null>(null);
  const [modalWebhook, setModalWebhook] = useState<Webhook | null | false>(false);
  const [deliveriesWebhook, setDeliveriesWebhook] = useState<Webhook | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoading(true);
    api.getDeveloperAvailability()
      .then(avail => {
        setAvailability(avail);
        if (avail.available) {
          return Promise.all([api.getApiKeys(), api.getWebhooks()]).then(([keys, hooks]) => {
            setApiKeys(keys);
            setWebhooks(hooks);
          });
        }
      })
      .catch(() => setAvailability({ available: false, events: [] }))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const loadKeys = () => api.getApiKeys().then(setApiKeys).catch(() => {});
  const loadWebhooks = () => api.getWebhooks().then(setWebhooks).catch(() => {});

  const handleDeleteKey = async (key: ApiKey) => {
    if (!confirm(`Delete API key "${key.name}"? Any integrations using it will stop working.`)) return;
    try {
      await api.deleteApiKey(key.id);
      showToast('API key deleted');
      loadKeys();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete API key', 'error');
    }
  };

  const handleDeleteWebhook = async (hook: Webhook) => {
    if (!confirm(`Delete webhook "${hook.name}"?`)) return;
    try {
      await api.deleteWebhook(hook.id);
      showToast('Webhook deleted');
      loadWebhooks();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete webhook', 'error');
    }
  };

  const handleTestWebhook = async (hook: Webhook) => {
    try {
      const result: any = await api.testWebhook(hook.id);
      showToast(result?.success === false ? (result?.error || 'Webhook test failed') : 'Webhook test sent', result?.success === false ? 'error' : 'success');
    } catch (err: any) {
      showToast(err.message || 'Webhook test failed', 'error');
    }
  };

  if (loading || !availability) {
    return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading…</div>;
  }

  if (!availability.available) {
    return (
      <div className="max-w-3xl space-y-8">
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <Crown size={22} />
          </div>
          <h3 className="text-base font-semibold text-gray-800 mb-1.5">API Access &amp; Webhooks — Enterprise</h3>
          <p className="text-sm text-gray-600 max-w-md mx-auto">
            API keys and outbound webhooks for ERP / external system integration are available on the
            Enterprise plan. Generate API keys for the read-only REST API and configure webhooks
            to push real-time events to your other systems.
          </p>
          <p className="text-xs text-gray-500 mt-3">
            Visit the <span className="font-semibold">Plan &amp; Billing</span> tab to upgrade.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* API info card */}
      <div className="card p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
            <Code size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-800">Enterprise REST API</div>
            <p className="text-xs text-gray-500 mt-0.5">
              Read-only API for integrating with ERP and other external systems.
              Base URL: <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">/api/v1</code>.
              Authenticate with <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">Authorization: Bearer &lt;api-key&gt;</code>.
            </p>
            <ul className="text-xs text-gray-600 mt-2 space-y-1 font-mono">
              <li><span className="text-emerald-600 font-semibold">GET</span> /api/v1/work-orders</li>
              <li><span className="text-emerald-600 font-semibold">GET</span> /api/v1/completions</li>
              <li><span className="text-emerald-600 font-semibold">GET</span> /api/v1/inventory</li>
            </ul>
          </div>
        </div>
      </div>

      {/* API Keys */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionHeader title="API Keys" subtitle="Generate keys to authenticate requests to the Enterprise API" />
          <button onClick={() => setShowNewKey(true)} className="btn-primary flex items-center gap-2 text-sm flex-shrink-0 -mt-5">
            <Plus size={14} /> Generate New Key
          </button>
        </div>
        {apiKeys.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center">
            <Key size={20} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">No API keys yet</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
            {/* The table scrolls inside itself: several of these columns do not fit
                a phone, and the rounded card around it clipped them off entirely. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Name</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Key</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Last Used</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Created</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {apiKeys.map(key => (
                    <tr key={key.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 text-gray-800 font-medium">{key.name}</td>
                      <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{key.key_prefix}••••••••</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{key.last_used_at ? new Date(key.last_used_at + 'Z').toLocaleString() : 'Never'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{new Date(key.created_at + 'Z').toLocaleDateString()}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end">
                          <button onClick={() => handleDeleteKey(key)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Webhooks */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionHeader title="Webhooks" subtitle="Push real-time events to an external URL" />
          <button onClick={() => setModalWebhook(null)} className="btn-primary flex items-center gap-2 text-sm flex-shrink-0 -mt-5">
            <Plus size={14} /> Add Webhook
          </button>
        </div>
        {webhooks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center">
            <WebhookIcon size={20} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">No webhooks configured</p>
          </div>
        ) : (
          <div className="space-y-3">
            {webhooks.map(hook => (
              <div key={hook.id} className="card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800">{hook.name}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${hook.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {hook.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{hook.url}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {hook.events.includes('*') ? 'All events' : hook.events.join(', ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setDeliveriesWebhook(hook)} title="View Deliveries"
                      className="px-2 py-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors text-xs font-medium flex items-center gap-1">
                      <Activity size={13} /> Deliveries
                    </button>
                    <button onClick={() => handleTestWebhook(hook)} title="Test"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                      <Send size={13} />
                    </button>
                    <button onClick={() => setModalWebhook(hook)} title="Edit"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDeleteWebhook(hook)} title="Delete"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNewKey && (
        <NewApiKeyModal
          onClose={() => setShowNewKey(false)}
          onCreated={(created) => { setShowNewKey(false); setRevealKey(created); loadKeys(); }}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}
      {revealKey && <RevealKeyModal apiKey={revealKey} onClose={() => setRevealKey(null)} />}
      {modalWebhook !== false && (
        <WebhookModal
          webhook={modalWebhook}
          availableEvents={availability.events}
          onClose={() => setModalWebhook(false)}
          onSaved={(msg) => { showToast(msg); loadWebhooks(); }}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}
      {deliveriesWebhook && (
        <WebhookDeliveriesModal webhook={deliveriesWebhook} onClose={() => setDeliveriesWebhook(null)} />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

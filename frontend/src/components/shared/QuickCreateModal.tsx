import { useState, useEffect } from 'react';
import { X, Plus, ChevronDown, Zap } from 'lucide-react';
import { api } from '../../api/client';
import { useSite } from '../../context/SiteContext';

interface Department { id: string; name: string; }

interface Props {
  onClose: () => void;
  onCreated?: (wo: any) => void;
}

function generateWONumber() {
  const year = new Date().getFullYear();
  const seq  = Math.floor(Math.random() * 900) + 100;
  return `WO-${year}-${seq}`;
}

export default function QuickCreateModal({ onClose, onCreated }: Props) {
  const { selectedSiteId } = useSite();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({
    part_name:     '',
    part_number:   'TBD',
    quantity_total: 1,
    department_id: '',
    scheduled_end: (() => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(17, 0, 0, 0);
      return d.toISOString().slice(0, 16);
    })(),
    priority: 'medium' as 'low' | 'medium' | 'high' | 'critical',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<any>(null);

  useEffect(() => {
    (api as any).getDepartments({ site_id: selectedSiteId || undefined }).then(setDepartments).catch(() => {});
  }, [selectedSiteId]);

  const set = (k: keyof typeof form, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!form.part_name.trim()) { setError('Part name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const wo = await (api as any).createWorkOrder({
        work_order_number: generateWONumber(),
        part_number:       form.part_number || 'TBD',
        part_name:         form.part_name.trim(),
        quantity:          Math.max(1, form.quantity_total),
        department_id:     form.department_id || null,
        scheduled_start:   new Date().toISOString(),
        scheduled_end:     form.scheduled_end ? new Date(form.scheduled_end).toISOString() : null,
        priority:          form.priority,
        status:            'pending',
        takt_time_minutes: 0,
        notes:             '',
        site_id:           selectedSiteId || null,
      });
      setCreated(wo);
      onCreated?.(wo);
    } catch (e: any) {
      setError(e.message ?? 'Failed to create work order');
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Zap size={22} className="text-green-600" />
          </div>
          <h3 className="font-semibold text-gray-900 text-lg mb-1">Work Order Created!</h3>
          <p className="text-gray-500 text-sm mb-1">{created.work_order_number}</p>
          <p className="text-gray-700 font-medium mb-4">{created.part_name}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 btn-secondary">Done</button>
            <button
              onClick={() => { setCreated(null); setForm(prev => ({ ...prev, part_name: '', part_number: 'TBD', quantity_total: 1 })); }}
              className="flex-1 btn-primary"
            >
              Create Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Plus size={15} className="text-white" />
            </div>
            <h2 className="font-semibold text-gray-900">Quick Work Order</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Part Name <span className="text-red-500">*</span></label>
            <input
              autoFocus
              className="input-field"
              placeholder="e.g. Hydraulic Pump Assembly"
              value={form.part_name}
              onChange={e => set('part_name', e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
              <input
                type="number"
                min={1}
                className="input-field"
                value={form.quantity_total}
                onChange={e => set('quantity_total', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
              <div className="relative">
                <select
                  className="input-field appearance-none pr-8"
                  value={form.priority}
                  onChange={e => set('priority', e.target.value)}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
              <div className="relative">
                <select
                  className="input-field appearance-none pr-8"
                  value={form.department_id}
                  onChange={e => set('department_id', e.target.value)}
                >
                  <option value="">— Any —</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Due Date</label>
              <input
                type="datetime-local"
                className="input-field"
                value={form.scheduled_end}
                onChange={e => set('scheduled_end', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 pb-5">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
            {saving ? 'Creating…' : 'Create Work Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

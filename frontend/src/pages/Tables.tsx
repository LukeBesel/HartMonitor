import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { MESTable, TableField, FieldType } from '../types';
import { Plus, Trash2, Database, ChevronRight, X, Edit3 } from 'lucide-react';
import { v4 as uuidv4 } from '../utils/uuid';

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
];

export default function Tables() {
  const [tables, setTables] = useState<MESTable[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newTable, setNewTable] = useState({ name: '', description: '' });
  const [newFields, setNewFields] = useState<TableField[]>([
    { id: uuidv4(), name: '', type: 'text' }
  ]);
  const navigate = useNavigate();

  const load = () => api.getTables().then(setTables);
  useEffect(() => { load(); }, []);

  const addField = () => setNewFields(f => [...f, { id: uuidv4(), name: '', type: 'text' }]);
  const removeField = (id: string) => setNewFields(f => f.filter(x => x.id !== id));
  const updateField = (id: string, updates: Partial<TableField>) => {
    setNewFields(f => f.map(x => x.id === id ? { ...x, ...updates } : x));
  };

  const handleCreate = async () => {
    if (!newTable.name.trim()) return;
    const validFields = newFields.filter(f => f.name.trim());
    const t = await api.createTable({ ...newTable, fields: validFields });
    setShowCreate(false);
    setNewTable({ name: '', description: '' });
    setNewFields([{ id: uuidv4(), name: '', type: 'text' }]);
    navigate(`/tables/${t.id}`);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this table and all its records?')) return;
    await api.deleteTable(id);
    load();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tables</h1>
          <p className="text-gray-500 text-sm mt-0.5 max-w-xl">
            Build your own simple spreadsheets to track anything the built-in features don’t cover —
            tooling logs, calibration records, supplier lists, custom checklists. Define the columns once, then add rows.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={16} /> New Table
        </button>
      </div>

      {tables.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Database size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No tables yet</p>
          <p className="text-sm">Create a table to store manufacturing data</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-4">
            <Plus size={14} /> Create Table
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tables.map(table => (
            <Link
              key={table.id}
              to={`/tables/${table.id}`}
              className="card p-5 hover:shadow-md transition-shadow group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                  <Database size={18} className="text-blue-600" />
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={e => handleDelete(table.id, e)}
                    className="p-1.5 hover:bg-red-50 rounded-lg text-gray-300 hover:text-red-500"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <h3 className="font-semibold text-gray-900">{table.name}</h3>
              {table.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{table.description}</p>}
              <div className="flex items-center justify-between mt-3 text-xs text-gray-400">
                <span>{table.fields.length} fields · {table.record_count} records</span>
                <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Create New Table</h2>
              <button onClick={() => setShowCreate(false)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Table Name *</label>
                <input className="input-field" placeholder="e.g. Part Inventory" value={newTable.name} onChange={e => setNewTable(p => ({ ...p, name: e.target.value }))} autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input className="input-field" placeholder="What data does this table store?" value={newTable.description} onChange={e => setNewTable(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Fields</label>
                  <button onClick={addField} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                    <Plus size={12} /> Add Field
                  </button>
                </div>
                <div className="space-y-2">
                  {newFields.map((field, i) => (
                    <div key={field.id} className="flex gap-2 items-center">
                      <input
                        className="input-field flex-1"
                        placeholder={`Field ${i + 1} name`}
                        value={field.name}
                        onChange={e => updateField(field.id, { name: e.target.value })}
                      />
                      <select className="input-field w-28" value={field.type} onChange={e => updateField(field.id, { type: e.target.value as FieldType })}>
                        {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      {newFields.length > 1 && (
                        <button onClick={() => removeField(field.id)} className="p-1.5 hover:bg-red-50 rounded text-gray-300 hover:text-red-400 flex-shrink-0">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 p-5 border-t border-gray-200">
              <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleCreate} disabled={!newTable.name.trim()} className="btn-primary flex-1">Create Table</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

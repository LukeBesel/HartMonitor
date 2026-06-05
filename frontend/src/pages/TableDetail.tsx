import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { MESTable, TableRecord, TableField, FieldType } from '../types';
import { Plus, Trash2, ChevronLeft, X, Edit3, Check, Database, Settings } from 'lucide-react';
import { v4 as uuidv4 } from '../utils/uuid';

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
];

export default function TableDetail() {
  const { id } = useParams<{ id: string }>();
  const [table, setTable] = useState<MESTable | null>(null);
  const [records, setRecords] = useState<TableRecord[]>([]);
  const [editingRecord, setEditingRecord] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [newRecord, setNewRecord] = useState<Record<string, any>>({});
  const [showFieldEditor, setShowFieldEditor] = useState(false);
  const [editingFields, setEditingFields] = useState<TableField[]>([]);

  const loadTable = () => {
    if (!id) return;
    Promise.all([api.getTable(id), api.getRecords(id)]).then(([t, r]) => {
      setTable(t);
      setRecords(r);
    });
  };

  useEffect(() => { loadTable(); }, [id]);

  const handleAddRecord = async () => {
    if (!id) return;
    await api.createRecord(id, newRecord);
    setNewRecord({});
    setShowAddRecord(false);
    loadTable();
  };

  const handleEditRecord = (record: TableRecord) => {
    setEditingRecord(record.id);
    setEditData({ ...record.data });
  };

  const handleSaveRecord = async (record: TableRecord) => {
    if (!id) return;
    await api.updateRecord(id, record.id, editData);
    setEditingRecord(null);
    loadTable();
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!id || !confirm('Delete this record?')) return;
    await api.deleteRecord(id, recordId);
    loadTable();
  };

  const handleSaveFields = async () => {
    if (!id || !table) return;
    await api.updateTable(id, { ...table, fields: editingFields });
    setShowFieldEditor(false);
    loadTable();
  };

  const renderCell = (field: TableField, record: TableRecord) => {
    const val = record.data[field.name];
    if (field.type === 'boolean') {
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${val ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {val ? '✓ Yes' : '✗ No'}
        </span>
      );
    }
    if (field.type === 'date' && val) {
      return <span className="text-gray-600 text-sm">{new Date(String(val)).toLocaleDateString()}</span>;
    }
    return <span className="text-gray-800 text-sm">{String(val ?? '—')}</span>;
  };

  const renderEditCell = (field: TableField) => {
    const val = editData[field.name];
    switch (field.type) {
      case 'boolean':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!val} onChange={e => setEditData(d => ({ ...d, [field.name]: e.target.checked }))} className="rounded" />
          </label>
        );
      case 'number':
        return <input type="number" className="input-field py-1 text-sm" value={val ?? ''} onChange={e => setEditData(d => ({ ...d, [field.name]: e.target.value ? Number(e.target.value) : '' }))} />;
      case 'date':
        return <input type="date" className="input-field py-1 text-sm" value={String(val ?? '')} onChange={e => setEditData(d => ({ ...d, [field.name]: e.target.value }))} />;
      case 'select':
        return (
          <select className="input-field py-1 text-sm" value={String(val ?? '')} onChange={e => setEditData(d => ({ ...d, [field.name]: e.target.value }))}>
            <option value="">—</option>
            {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      default:
        return <input type="text" className="input-field py-1 text-sm" value={String(val ?? '')} onChange={e => setEditData(d => ({ ...d, [field.name]: e.target.value }))} />;
    }
  };

  const renderInputCell = (field: TableField) => {
    const val = newRecord[field.name];
    switch (field.type) {
      case 'boolean':
        return <input type="checkbox" checked={!!val} onChange={e => setNewRecord(d => ({ ...d, [field.name]: e.target.checked }))} className="rounded" />;
      case 'number':
        return <input type="number" className="input-field py-1 text-sm" value={val ?? ''} onChange={e => setNewRecord(d => ({ ...d, [field.name]: e.target.value ? Number(e.target.value) : '' }))} placeholder="0" />;
      case 'date':
        return <input type="date" className="input-field py-1 text-sm" value={String(val ?? '')} onChange={e => setNewRecord(d => ({ ...d, [field.name]: e.target.value }))} />;
      default:
        return <input type="text" className="input-field py-1 text-sm" value={String(val ?? '')} onChange={e => setNewRecord(d => ({ ...d, [field.name]: e.target.value }))} placeholder={`${field.name}...`} />;
    }
  };

  if (!table) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/tables" className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
            <ChevronLeft size={18} />
          </Link>
          <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
            <Database size={16} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{table.name}</h1>
            {table.description && <p className="text-gray-500 text-xs">{table.description}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setEditingFields([...table.fields]); setShowFieldEditor(true); }} className="btn-secondary text-xs">
            <Settings size={13} /> Manage Fields
          </button>
          <button onClick={() => setShowAddRecord(true)} className="btn-primary text-xs">
            <Plus size={14} /> Add Record
          </button>
        </div>
      </div>

      <div className="text-xs text-gray-400">{records.length} records · {table.fields.length} fields</div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {table.fields.map(f => (
                  <th key={f.id} className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider whitespace-nowrap">
                    {f.name}
                    <span className="ml-1 text-gray-400 font-normal normal-case">({f.type})</span>
                  </th>
                ))}
                <th className="w-20 px-4 py-3" />
              </tr>
              {showAddRecord && (
                <tr className="bg-blue-50 border-b border-blue-200">
                  {table.fields.map(f => (
                    <td key={f.id} className="px-3 py-2">{renderInputCell(f)}</td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button onClick={handleAddRecord} className="p-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700"><Check size={12} /></button>
                      <button onClick={() => { setShowAddRecord(false); setNewRecord({}); }} className="p-1.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300"><X size={12} /></button>
                    </div>
                  </td>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.length === 0 && !showAddRecord && (
                <tr>
                  <td colSpan={table.fields.length + 1} className="text-center py-10 text-gray-400 text-sm">
                    No records yet. Add a record to get started.
                  </td>
                </tr>
              )}
              {records.map(record => (
                <tr key={record.id} className="hover:bg-gray-50 group transition-colors">
                  {table.fields.map(f => (
                    <td key={f.id} className="px-4 py-3">
                      {editingRecord === record.id ? renderEditCell(f) : renderCell(f, record)}
                    </td>
                  ))}
                  <td className="px-3 py-3">
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {editingRecord === record.id ? (
                        <>
                          <button onClick={() => handleSaveRecord(record)} className="p-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700"><Check size={12} /></button>
                          <button onClick={() => setEditingRecord(null)} className="p-1.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300"><X size={12} /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => handleEditRecord(record)} className="p-1.5 hover:bg-blue-50 rounded-lg text-gray-400 hover:text-blue-600"><Edit3 size={12} /></button>
                          <button onClick={() => handleDeleteRecord(record.id)} className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-600"><Trash2 size={12} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Field editor modal */}
      {showFieldEditor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Manage Fields</h2>
              <button onClick={() => setShowFieldEditor(false)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-2">
              {editingFields.map((field, i) => (
                <div key={field.id} className="flex gap-2 items-center">
                  <input
                    className="input-field flex-1"
                    value={field.name}
                    onChange={e => setEditingFields(f => f.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                  />
                  <select
                    className="input-field w-28"
                    value={field.type}
                    onChange={e => setEditingFields(f => f.map((x, j) => j === i ? { ...x, type: e.target.value as FieldType } : x))}
                  >
                    {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <button
                    onClick={() => setEditingFields(f => f.filter((_, j) => j !== i))}
                    className="p-1.5 hover:bg-red-50 rounded text-gray-300 hover:text-red-400 flex-shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setEditingFields(f => [...f, { id: uuidv4(), name: '', type: 'text' }])}
                className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-2"
              >
                <Plus size={13} /> Add Field
              </button>
            </div>
            <div className="flex gap-2 p-5 border-t border-gray-200">
              <button onClick={() => setShowFieldEditor(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleSaveFields} className="btn-primary flex-1">Save Fields</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Excel / CSV → Table import modal ─────────────────────────────────────────
// One import flow shared by the Tables page and the builder's table-lookup
// config form (spec: builder insertion). Picks an .xlsx/.csv, shows a client-
// side preview (first 5 parsed rows for csv; filename + size for xlsx), lets
// the user name the table (prefilled from the filename), then POSTs the file
// as base64 to /api/tables/import and hands the created table to the caller.

import { useRef, useState } from 'react';
import { FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { api } from '../../api/client';
import type { MESTable } from '../../types';

const MAX_BYTES = 10 * 1024 * 1024; // server cap: 10 MB decoded

interface PickedFile {
  name: string;
  size: number;
  base64: string;
  /** First rows parsed client-side — csv only (xlsx preview is name + size). */
  previewRows: string[][] | null;
}

interface TableImportModalProps {
  onClose: () => void;
  onImported: (table: MESTable) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/** Minimal CSV row parser (quotes + escaped quotes) for the preview only —
 *  the server does the authoritative parse. Returns up to maxRows rows. */
export function parseCsvPreview(text: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows.slice(0, maxRows);
}

export default function TableImportModal({ onClose, onImported }: TableImportModalProps) {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setError('');
    if (!/\.(xlsx|csv)$/i.test(f.name)) {
      setError('Pick an .xlsx or .csv file.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`File is too large — max ${MAX_BYTES / (1024 * 1024)} MB.`);
      return;
    }
    try {
      const buf = await f.arrayBuffer();
      const isCsv = /\.csv$/i.test(f.name);
      const previewRows = isCsv
        ? parseCsvPreview(new TextDecoder().decode(buf.slice(0, 256 * 1024)), 6) // header + 5 rows
        : null;
      setFile({ name: f.name, size: f.size, base64: arrayBufferToBase64(buf), previewRows });
      setName(prev => prev.trim() ? prev : f.name.replace(/\.[^.]+$/, ''));
    } catch {
      setError('Could not read that file.');
    }
  };

  const handleImport = async () => {
    if (!file || !name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const table = await api.importTable({ name: name.trim(), data: file.base64, filename: file.name });
      onImported(table);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setBusy(false);
    }
  };

  const header = file?.previewRows?.[0] ?? [];
  const bodyRows = file?.previewRows?.slice(1) ?? [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Import Excel / CSV</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }}
          />

          {!file ? (
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50/50 rounded-xl p-8 flex flex-col items-center gap-2 text-gray-500 transition-colors"
            >
              <Upload size={28} className="opacity-50" />
              <span className="font-medium text-sm">Choose an .xlsx or .csv file</span>
              <span className="text-xs text-gray-400">
                First row becomes the columns · up to 50 columns, 5,000 rows, 10 MB
              </span>
            </button>
          ) : (
            <>
              <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
                <FileSpreadsheet size={20} className="text-green-600 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
                </div>
                <button
                  onClick={() => inputRef.current?.click()}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium flex-shrink-0"
                >
                  Change
                </button>
              </div>

              {file.previewRows ? (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Preview — first {bodyRows.length} row{bodyRows.length === 1 ? '' : 's'}</p>
                  <div className="border border-gray-200 rounded-lg overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          {header.map((h, i) => (
                            <th key={i} className="px-2.5 py-1.5 text-left font-semibold text-gray-600 whitespace-nowrap">
                              {h.trim() || `Column ${i + 1}`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bodyRows.map((r, ri) => (
                          <tr key={ri} className="border-b border-gray-100 last:border-0">
                            {header.map((_, ci) => (
                              <td key={ci} className="px-2.5 py-1.5 text-gray-700 whitespace-nowrap max-w-[160px] truncate">
                                {r[ci] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-500">
                  Excel workbook — the first sheet will be imported (first row as column headers).
                </p>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Table name *</label>
                <input
                  className="input-field"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Part Inventory"
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex gap-2 p-5 border-t border-gray-200">
          <button onClick={onClose} className="btn-secondary flex-1" disabled={busy}>Cancel</button>
          <button
            onClick={handleImport}
            disabled={!file || !name.trim() || busy}
            className="btn-primary flex-1"
          >
            {busy ? <><Loader2 size={14} className="animate-spin" /> Importing…</> : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

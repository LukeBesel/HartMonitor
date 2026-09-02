// ─── Data export ────────────────────────────────────────────────────────────
import { useState, useRef } from 'react';
import { Download, Activity, ClipboardList, Package, ArrowUpDown, ShoppingCart, ShieldCheck, Archive } from 'lucide-react';
import { api } from '../../api/client';
import { Toast } from './shared';

// ─── Tab 4: Data Export ───────────────────────────────────────────────────────

interface ExportCard {
  icon: React.ReactNode;
  title: string;
  description: string;
  type: string;
  params?: Record<string, string>;
}

const EXPORT_CARDS: ExportCard[] = [
  {
    icon: <Activity size={20} />,
    title: 'Completions',
    description: 'All production completions with cycle times',
    type: 'completions',
    params: { days: '90' },
  },
  {
    icon: <ClipboardList size={20} />,
    title: 'Work Orders',
    description: 'All work orders with status and progress',
    type: 'work-orders',
  },
  {
    icon: <Package size={20} />,
    title: 'Inventory',
    description: 'Current stock levels and item catalog',
    type: 'inventory',
  },
  {
    icon: <ArrowUpDown size={20} />,
    title: 'Stock Movements',
    description: 'Full audit trail of stock changes',
    type: 'stock-movements',
  },
  {
    icon: <ShoppingCart size={20} />,
    title: 'Purchase Orders',
    description: 'All purchase orders with line items',
    type: 'purchase-orders',
  },
  {
    icon: <ShieldCheck size={20} />,
    title: 'NCRs / Quality',
    description: 'Non-conformance reports and resolutions',
    type: 'ncrs',
  },
];

function ExportCardItem({ card, onError }: { card: ExportCard; onError: (m: string) => void }) {
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);

  const handleDownloadCsv = async () => {
    setDownloadingCsv(true);
    try {
      await api.downloadExport(card.type, card.params);
    } catch (err: any) {
      onError(err?.message || `Failed to export ${card.title}`);
    } finally {
      setDownloadingCsv(false);
    }
  };

  const handleDownloadXlsx = async () => {
    setDownloadingXlsx(true);
    try {
      await api.downloadExport(card.type, { ...card.params, format: 'xlsx' });
    } catch (err: any) {
      onError(err?.message || `Failed to export ${card.title}`);
    } finally {
      setDownloadingXlsx(false);
    }
  };

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}
        >
          {card.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-800">{card.title}</div>
          <div className="text-xs text-gray-500 mt-0.5">{card.description}</div>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleDownloadCsv}
          disabled={downloadingCsv}
          className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm py-1.5"
        >
          {downloadingCsv ? (
            <span className="w-3.5 h-3.5 border-2 border-current/40 border-t-current rounded-full animate-spin" />
          ) : (
            <Download size={14} />
          )}
          CSV
        </button>
        <button
          onClick={handleDownloadXlsx}
          disabled={downloadingXlsx}
          className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm py-1.5"
        >
          {downloadingXlsx ? (
            <span className="w-3.5 h-3.5 border-2 border-current/40 border-t-current rounded-full animate-spin" />
          ) : (
            <Download size={14} />
          )}
          Excel
        </button>
      </div>
    </div>
  );
}

export function ExportTab() {
  const [bundleDownloading, setBundleDownloading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const handleBundle = async () => {
    setBundleDownloading(true);
    try {
      await api.downloadExport('all');
    } catch (err: any) {
      showToast(err?.message || 'Failed to export data bundle', 'error');
    } finally {
      setBundleDownloading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <p className="text-sm text-gray-600">
          Download all your data as CSV files or a complete JSON bundle.
        </p>
      </div>

      {/* 2×3 grid */}
      <div className="grid grid-cols-2 gap-4">
        {EXPORT_CARDS.map((card) => (
          <ExportCardItem key={card.type} card={card} onError={(m) => showToast(m, 'error')} />
        ))}
      </div>

      {/* JSON Bundle */}
      <div className="card p-6 border-2 border-dashed border-gray-200">
        <div className="flex items-start gap-4 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}
          >
            <Archive size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800">Export All as JSON Bundle</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Contains all data in a single JSON file for backup or migration.
              Includes apps, completions, work orders, inventory, purchases, and quality records.
            </div>
          </div>
        </div>
        <button
          onClick={handleBundle}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {bundleDownloading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Preparing bundle…
            </>
          ) : (
            <>
              <Download size={16} />
              Download Complete Data Bundle (.json)
            </>
          )}
        </button>
      </div>

      {/* Self-service full data export */}
      <div className="card p-6 border border-gray-200 bg-gray-50">
        <div className="flex items-start gap-4 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gray-200 text-gray-600"
          >
            <Download size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800">Export All My Data</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Download a complete JSON snapshot of all your company data — work orders, completions,
              departments, stations, users, inventory, and more. Your data is always yours.
            </div>
          </div>
        </div>
        <button
          onClick={async () => {
            const res = await fetch('/api/config/export-data', { credentials: 'include' });
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hartmonitor-export-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm"
        >
          <Download size={16} />
          Export all my data
        </button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

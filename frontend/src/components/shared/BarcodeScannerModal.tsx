import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, Camera, AlertCircle } from 'lucide-react';

interface Props {
  onClose: () => void;
  onScan: (text: string) => void;
  title?: string;
  hint?: string;
}

const SCANNER_ELEMENT_ID = 'hm-barcode-scanner-region';

const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
];

export default function BarcodeScannerModal({ onClose, onScan, title = 'Scan Barcode', hint }: Props) {
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let started = false;
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
      formatsToSupport: SUPPORTED_FORMATS,
      verbose: false,
    });

    const stopAndClear = () => {
      const promise = started ? scanner.stop().catch(() => {}) : Promise.resolve();
      promise.finally(() => scanner.clear());
    };

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        decodedText => {
          if (cancelled) return;
          cancelled = true;
          stopAndClear();
          onScan(decodedText);
        },
        () => { /* ignore per-frame "no code found" errors */ }
      )
      .then(() => { started = true; })
      .catch(err => {
        if (!cancelled) setError(err?.message || 'Unable to access camera. Check permissions and try again.');
      });

    return () => {
      cancelled = true;
      stopAndClear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <Camera size={15} className="text-blue-600" />
            </div>
            <div className="font-semibold text-gray-900 text-sm">{title}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-4">
          {error ? (
            <div className="text-center py-8">
              <AlertCircle size={32} className="mx-auto mb-2 text-red-500" />
              <p className="text-sm text-gray-700 font-medium">Camera unavailable</p>
              <p className="text-xs text-gray-500 mt-1">{error}</p>
            </div>
          ) : (
            <>
              <div id={SCANNER_ELEMENT_ID} className="rounded-xl overflow-hidden bg-gray-900 min-h-[250px]" />
              <p className="text-xs text-gray-500 text-center mt-3">
                {hint || 'Point your camera at a barcode or QR code'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

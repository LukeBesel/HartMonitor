import { useRef, useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { api } from '../../api/client';
import type { Widget } from '../../types';

const MAX_BYTES = 15 * 1024 * 1024; // matches the existing upload pipeline

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/** photo-capture widget (spec §4.2): camera/file capture through the existing
 *  api.uploadImage pipeline, thumbnail strip, maxPhotos cap. Value is the
 *  uploaded URL(s), comma-joined — satisfies `require_photo` gates. In preview
 *  mode nothing is uploaded; the photo stays as a local data URL. */
export default function PhotoSheet({ widget, value, onChange, preview, invalid }: {
  widget: Widget;
  value: string | undefined;
  onChange: (v: string) => void;
  preview: boolean;
  invalid?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const urls = (value || '').split(',').map(s => s.trim()).filter(Boolean);
  const maxPhotos = widget.config.maxPhotos ?? 1;
  const canAdd = urls.length < maxPhotos && !busy;

  const handleFile = async (file: File) => {
    setError('');
    const type = (file.type || '').toLowerCase();
    if (type === 'image/heic' || type === 'image/heif' || /\.hei[cf]$/i.test(file.name)) {
      setError('HEIC photos are not supported — use JPEG or PNG');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Photo is too large (max 15MB)');
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readAsDataURL(file);
      let url = dataUrl;
      if (!preview) {
        const base64 = dataUrl.split(',')[1] ?? '';
        const res = await api.uploadImage(base64, type || 'image/jpeg', file.name || 'photo.jpg');
        url = res.url;
      }
      onChange([...urls, url].join(','));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const removeAt = (i: number) => {
    onChange(urls.filter((_, idx) => idx !== i).join(','));
  };

  return (
    <div className={`p-card p-4 ${invalid ? 'p-input-invalid' : ''}`}>
      {widget.label && (
        <div className="p-label">
          {widget.label}
          {widget.config.required && <span style={{ color: 'var(--p-bad)' }} className="ml-1">*</span>}
        </div>
      )}

      {urls.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-3">
          {urls.map((u, i) => (
            <div key={`${u.slice(0, 40)}-${i}`} className="relative">
              <img
                src={u}
                alt={`Photo ${i + 1}`}
                className="object-cover rounded-lg"
                style={{ width: 96, height: 96, border: '1px solid var(--p-border)' }}
              />
              <button
                onClick={() => removeAt(i)}
                aria-label="Remove photo"
                className="absolute -top-2 -right-2 flex items-center justify-center rounded-full"
                style={{ width: 28, height: 28, background: 'var(--p-bad-strong)', color: '#fff' }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {canAdd && (
        <button
          onClick={() => inputRef.current?.click()}
          className="p-btn p-btn-ghost w-full"
          style={{ minHeight: 64, borderStyle: 'dashed' }}
        >
          {busy ? <Loader2 size={20} className="animate-spin" /> : <Camera size={20} />}
          {busy ? 'Uploading…' : urls.length > 0 ? 'Add another photo' : 'Take photo'}
        </button>
      )}
      {!canAdd && urls.length >= maxPhotos && (
        <div style={{ fontSize: 13, color: 'var(--p-muted)' }}>
          {maxPhotos} photo{maxPhotos > 1 ? 's' : ''} max
        </div>
      )}

      {error && <div className="p-field-error">{error}</div>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

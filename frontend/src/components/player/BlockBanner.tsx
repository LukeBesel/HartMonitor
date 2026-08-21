import { AlertOctagon, X } from 'lucide-react';

/** Full-width red banner shown by `block_with_error` trigger actions (spec
 *  §5.5). Dismisses on tap anywhere in the banner. */
export default function BlockBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div
      className="p-block-banner"
      role="alert"
      onClick={onDismiss}
      title="Tap to dismiss"
    >
      <AlertOctagon size={22} className="flex-shrink-0" />
      <span className="flex-1">{text}</span>
      <X size={18} className="flex-shrink-0 opacity-80" />
    </div>
  );
}

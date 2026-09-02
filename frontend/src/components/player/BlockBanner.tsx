import { AlertOctagon, ArrowDownCircle, X } from 'lucide-react';

/** Full-width red banner shown by `block_with_error` trigger actions and by the
 *  standing validation gate when a forward tap is refused (spec §5.5). It names
 *  what is missing; "Show me" takes the operator to it. Dismisses on tap
 *  anywhere else in the banner. */
export default function BlockBanner({ text, onDismiss, onLocate }: {
  text: string;
  onDismiss: () => void;
  /** Present when the block belongs to a widget on screen. */
  onLocate?: () => void;
}) {
  return (
    <div
      className="p-block-banner"
      role="alert"
      aria-live="assertive"
      onClick={onDismiss}
      title="Tap to dismiss"
    >
      <AlertOctagon size={22} className="flex-shrink-0" />
      <span className="flex-1">{text}</span>
      {onLocate && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onLocate(); }}
          className="flex items-center gap-1.5 flex-shrink-0"
          style={{
            fontWeight: 700, fontSize: 14, minHeight: 36, padding: '0 10px',
            borderRadius: 10, border: '1.5px solid currentColor',
          }}
        >
          <ArrowDownCircle size={15} /> Show me
        </button>
      )}
      <X size={18} className="flex-shrink-0 opacity-80" />
    </div>
  );
}

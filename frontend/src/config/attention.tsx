import {
  CalendarCheck, Wrench, ShieldCheck, Package, ShoppingCart,
  MoreHorizontal, AlertCircle, BellRing,
} from 'lucide-react';
import type { AttentionType } from '../types';

const ICONS: Record<AttentionType, React.ReactNode> = {
  wo_overdue:   <CalendarCheck size={15} />,
  wo_behind:    <CalendarCheck size={15} />,
  station_down: <Wrench size={15} />,
  ncr_critical: <ShieldCheck size={15} />,
  stock_low:    <Package size={15} />,
  po_late:      <ShoppingCart size={15} />,
  // A call notifies people — it does not dial anyone, so no phone imagery.
  andon_call:   <BellRing size={15} />,
  more:         <MoreHorizontal size={15} />,
};

const TYPE_LABELS: Record<AttentionType, string> = {
  wo_overdue:   'Work order overdue',
  wo_behind:    'Work order behind',
  station_down: 'Station down',
  ncr_critical: 'Critical NCR',
  stock_low:    'Low stock',
  po_late:      'Late delivery',
  andon_call:   'Open call',
  more:         'And more',
};

/** Fallbacks so an item type this build doesn't know about still renders. */
export const ATTENTION_ICON_FALLBACK = <AlertCircle size={15} />;

// Every enum rendered through a page config map needs a fallback, so an
// attention type this build doesn't know about still renders a usable row.
export function attentionIcon(type: string): React.ReactNode {
  return ICONS[type as AttentionType] ?? ATTENTION_ICON_FALLBACK;
}

export function attentionLabel(type: string): string {
  return TYPE_LABELS[type as AttentionType] ?? 'Needs attention';
}

/** @deprecated use attentionIcon() — kept so unknown types can't render blank. */
export const ATTENTION_ICONS = ICONS;
/** @deprecated use attentionLabel() */
export const ATTENTION_TYPE_LABELS = TYPE_LABELS;

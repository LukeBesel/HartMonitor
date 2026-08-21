import { CalendarCheck, Wrench, ShieldCheck, Package, ShoppingCart, PhoneCall } from 'lucide-react';
import type { AttentionType } from '../types';

export const ATTENTION_ICONS: Record<AttentionType, React.ReactNode> = {
  wo_overdue:   <CalendarCheck size={15} />,
  wo_behind:    <CalendarCheck size={15} />,
  station_down: <Wrench size={15} />,
  ncr_critical: <ShieldCheck size={15} />,
  stock_low:    <Package size={15} />,
  po_late:      <ShoppingCart size={15} />,
  andon_call:   <PhoneCall size={15} />,
};

export const ATTENTION_TYPE_LABELS: Record<AttentionType, string> = {
  wo_overdue:   'Work order overdue',
  wo_behind:    'Work order behind',
  station_down: 'Station down',
  ncr_critical: 'Critical NCR',
  stock_low:    'Low stock',
  po_late:      'Late delivery',
  andon_call:   'Team called',
};

/** Fallbacks so an item type this build doesn't know about still renders. */
export const ATTENTION_ICON_FALLBACK = <ShieldCheck size={15} />;

export function attentionIcon(type: AttentionType): React.ReactNode {
  return ATTENTION_ICONS[type] ?? ATTENTION_ICON_FALLBACK;
}

export function attentionLabel(type: AttentionType): string {
  return ATTENTION_TYPE_LABELS[type] ?? 'Needs attention';
}

import { CalendarCheck, Wrench, ShieldCheck, Package, ShoppingCart } from 'lucide-react';
import type { AttentionType } from '../types';

export const ATTENTION_ICONS: Record<AttentionType, React.ReactNode> = {
  wo_overdue:   <CalendarCheck size={15} />,
  wo_behind:    <CalendarCheck size={15} />,
  station_down: <Wrench size={15} />,
  ncr_critical: <ShieldCheck size={15} />,
  stock_low:    <Package size={15} />,
  po_late:      <ShoppingCart size={15} />,
};

export const ATTENTION_TYPE_LABELS: Record<AttentionType, string> = {
  wo_overdue:   'Work order overdue',
  wo_behind:    'Work order behind',
  station_down: 'Station down',
  ncr_critical: 'Critical NCR',
  stock_low:    'Low stock',
  po_late:      'Late delivery',
};

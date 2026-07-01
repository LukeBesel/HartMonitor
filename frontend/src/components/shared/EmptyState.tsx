import { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  /** Lucide icon component (not an element), e.g. `icon={Inbox}`. */
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Optional action slot — typically a `btn-primary` / `btn-secondary` button or Link. */
  action?: ReactNode;
  /** Compact vertical padding for use inside small cards. */
  compact?: boolean;
  className?: string;
}

/**
 * Friendly centered empty state for lists / tables / cards with no data.
 */
export default function EmptyState({ icon: Icon, title, description, action, compact, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center px-4 ${compact ? 'py-6' : 'py-10'} ${className}`}>
      {Icon && (
        <div className={`${compact ? 'w-10 h-10 mb-2.5' : 'w-12 h-12 mb-3'} rounded-full bg-gray-100 flex items-center justify-center`}>
          <Icon size={compact ? 18 : 22} className="text-gray-400" strokeWidth={1.75} />
        </div>
      )}
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      {description && (
        <p className="text-xs text-gray-400 mt-1 max-w-xs leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

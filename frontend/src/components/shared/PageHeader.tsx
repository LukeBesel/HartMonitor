import { ReactNode } from 'react';

export interface PageHeaderProps {
  /** Main page title. */
  title: ReactNode;
  /** Optional secondary line under the title. */
  subtitle?: ReactNode;
  /** Optional right-side slot for buttons / filters. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Standard page header: bold tight title, muted subtitle, right-aligned
 * action slot. Pages control their own vertical rhythm (e.g. via `space-y-6`
 * on the page container), so this adds no outer margin by default.
 */
export default function PageHeader({ title, subtitle, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`flex items-start justify-between flex-wrap gap-3 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight leading-tight">{title}</h1>
        {subtitle != null && subtitle !== '' && (
          <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>
        )}
      </div>
      {/* The action cluster wraps rather than holding one rigid line. Three
          buttons ("Export CSV", "Full analytics", "Run app") are 567px across —
          on a 390px phone `flex-shrink-0` sent them straight off the right edge
          and took the page's width with them. */}
      {actions && <div className="flex flex-wrap items-center gap-2 min-w-0">{actions}</div>}
    </div>
  );
}

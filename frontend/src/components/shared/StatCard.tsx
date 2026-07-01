import { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';

export interface StatCardProps {
  /** Small metric label shown under the value. */
  label: string;
  /** The big number / value. */
  value: ReactNode;
  /** Percentage delta vs. some baseline. Positive renders green ↑, negative red ↓. */
  delta?: number | null;
  /** Context appended after the delta (e.g. "vs 7-day avg"), or shown alone as muted trend text. */
  deltaLabel?: string;
  /** Optional icon element (e.g. <CheckCircle size={18} />). */
  icon?: ReactNode;
  /** Tailwind classes for the icon chip background / color. */
  iconBg?: string;
  iconColor?: string;
  /** Show a pulsing "live" dot on the icon chip. */
  pulse?: boolean;
  className?: string;
}

/**
 * KPI stat card matching the app's `.stat-card` token (white surface, hairline
 * border, rounded-2xl — auto-adapts in dark mode). Drop-in for stat rows.
 */
export default function StatCard({
  label, value, delta, deltaLabel, icon, iconBg = 'bg-blue-50', iconColor = 'text-blue-600', pulse, className = '',
}: StatCardProps) {
  return (
    <div className={`stat-card ${className}`}>
      <div className="flex items-start gap-3">
        {icon && (
          <div className={`relative w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
            <span className={iconColor}>{icon}</span>
            {pulse && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400">
                <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping opacity-75" />
              </span>
            )}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-2xl font-bold text-gray-900 leading-none tabular-nums">{value}</div>
          <div className="text-xs font-medium text-gray-600 mt-1">{label}</div>
          {delta !== undefined && delta !== null ? (
            <div className={`flex items-center gap-1 text-xs mt-0.5 font-medium ${delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {delta >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {delta >= 0 ? '+' : ''}{delta}%{deltaLabel ? ` ${deltaLabel}` : ''}
            </div>
          ) : deltaLabel ? (
            <div className="text-xs text-gray-400 mt-0.5">{deltaLabel}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

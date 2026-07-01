interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse bg-gray-700/50 rounded ${className}`} />;
}

export function SkeletonRow() {
  return <div className="h-12 bg-gray-700/50 rounded-lg animate-pulse mb-2" />;
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      <div className="h-8 bg-gray-600/50 rounded-lg animate-pulse mb-3 w-3/4" />
      {Array.from({ length: rows }, (_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}

export function SkeletonCard({ className = '' }: SkeletonProps) {
  return <div className={`bg-gray-700/50 rounded-xl animate-pulse ${className}`} />;
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-${count} gap-4 mb-6`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="h-4 bg-gray-700/50 rounded animate-pulse mb-2 w-2/3" />
          <div className="h-8 bg-gray-700/50 rounded animate-pulse w-1/2" />
        </div>
      ))}
    </div>
  );
}

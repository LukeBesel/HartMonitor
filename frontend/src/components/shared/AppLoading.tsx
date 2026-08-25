import { Activity } from 'lucide-react';

/**
 * The full-screen wait: shown while the session is being restored and while a
 * lazily-loaded page chunk arrives.
 *
 * An unlabelled spinner is indistinguishable from a page that has broken, and
 * on a slow plant connection it is the first thing a visitor ever sees. The
 * mark and one line of text say "this is HartMonitor, and it is working" while
 * they wait. There is deliberately no progress bar: nothing here knows how far
 * along the load is, and a bar that guesses would be inventing it.
 */
export default function AppLoading({ message = 'Loading your workspace…' }: { message?: string }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center animate-fade-in">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 shadow-lg">
          <Activity size={28} className="text-white" />
        </div>
        <p className="mt-4 text-lg font-semibold text-gray-800 tracking-tight">HartMonitor</p>
        <p className="mt-1 text-sm text-gray-500">{message}</p>
        <div className="mt-6 w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}

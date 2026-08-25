import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isStaleChunkError, takeStaleChunkReload } from '../../utils/staleChunk';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // A chunk that vanished under a deploy is not a bug in this screen — the
    // build simply moved. Take the new one rather than showing an operator a
    // dead page. takeStaleChunkReload() rate-limits, so a genuinely missing
    // asset falls through to the message below instead of looping.
    if (isStaleChunkError(error) && takeStaleChunkReload()) {
      window.location.reload();
      return;
    }
    console.error('[ErrorBoundary]', error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-red-500 mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            {isStaleChunkError(this.state.error) ? 'A new version is available' : 'Something went wrong'}
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            {isStaleChunkError(this.state.error)
              ? 'This tab was open while HartMonitor updated. Reload to pick up the new version.'
              : this.state.error.message}
          </p>
          <button
            onClick={() => {
              if (isStaleChunkError(this.state.error)) { window.location.reload(); return; }
              this.setState({ error: null });
            }}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg text-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {isStaleChunkError(this.state.error) ? 'Reload' : 'Try Again'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

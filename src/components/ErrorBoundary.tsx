import React from 'react';
import { XCircle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo });
  }

  private handleCopy = () => {
    const text = [
      this.state.error?.message ?? 'Unknown error',
      '',
      this.state.errorInfo?.componentStack ?? '',
    ].join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 bg-surface-900 flex flex-col items-center justify-center gap-6 p-8">
          <XCircle size={48} className="text-red-400" />
          <div className="text-center space-y-2">
            <h1 className="font-display font-bold text-xl text-white">
              Something went wrong
            </h1>
            <p className="text-white/50 text-sm max-w-sm">
              An unexpected error occurred. Please reload the app.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => window.location.reload()}
              className="btn-primary"
            >
              Reload App
            </button>
            <button
              onClick={this.handleCopy}
              className="btn-secondary"
            >
              Copy Error
            </button>
          </div>
          {import.meta.env.DEV && (
            <pre className="mt-4 max-w-2xl max-h-48 overflow-auto text-xs text-red-300/70 bg-surface-800 rounded-lg p-4 border border-red-500/20">
              {this.state.error.message}
              {'\n'}
              {this.state.errorInfo?.componentStack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

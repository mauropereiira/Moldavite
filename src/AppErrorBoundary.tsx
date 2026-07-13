/** Last-resort recovery UI for uncaught errors anywhere in the React tree. */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[AppErrorBoundary] Uncaught render error:', error, errorInfo.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main
          role="alert"
          className="h-screen w-screen flex items-center justify-center p-6"
          style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
        >
          <div
            className="max-w-md w-full p-6 text-center"
            style={{
              backgroundColor: 'var(--bg-panel)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Reload Moldavite to recover your workspace.
            </p>
            <button
              type="button"
              className="btn btn-primary mt-5 px-4 py-2 focus-ring"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changing this clears the caught error and remounts the subtree. */
  resetKey?: string;
  onError?: (error: Error) => void;
}

interface State {
  hasError: boolean;
  errorCount: number;
}

const MAX_ERROR_COUNT = 3;

/**
 * Error boundary specifically for the TipTap editor.
 * Catches NotFoundError and other DOM-related errors that can occur
 * when switching notes or during editor destruction.
 */
export class EditorErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorCount: 0 };
  }

  static getDerivedStateFromError(_error: Error): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[EditorErrorBoundary] Caught error:', error.message);
    console.error('[EditorErrorBoundary] Component stack:', errorInfo.componentStack);

    this.setState((prev) => ({ errorCount: prev.errorCount + 1 }));

    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: Props, _prevState: State): void {
    // Reset error state when resetKey changes (user switched to a different note)
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, errorCount: 0 });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.state.errorCount >= MAX_ERROR_COUNT) {
        return (
          <div
            className="h-full flex items-center justify-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <p>Editor encountered an error. Try selecting a different note.</p>
          </div>
        );
      }
      // Return empty div to maintain layout - prevents parent from breaking
      return <div className="h-full" />;
    }

    return this.props.children;
  }
}

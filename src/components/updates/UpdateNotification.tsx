import { useEffect } from 'react';
import { useUpdateStore } from '@/stores';
import { Download, X, RefreshCw } from 'lucide-react';

export function UpdateNotification() {
  const {
    available,
    version,
    downloading,
    progress,
    error,
    dismissed,
    installUpdate,
    dismiss,
    startPeriodicChecks,
  } = useUpdateStore();

  // Start periodic update checks on mount
  useEffect(() => {
    const cleanup = startPeriodicChecks();
    return cleanup;
  }, [startPeriodicChecks]);

  // Don't render if no update available or dismissed
  if (!available || dismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-2 fade-in duration-300">
      <div
        className="rounded-lg shadow-lg overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{
            backgroundColor: 'var(--accent-subtle)',
            borderBottom: '1px solid var(--accent-color)',
          }}
        >
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4" style={{ color: 'var(--accent-color)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Update Available
            </span>
          </div>
          <button
            onClick={dismiss}
            className="p-1 rounded transition-colors hover:opacity-70"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
            Version <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{version}</span> is ready to install.
          </p>

          {/* Error message */}
          {error && (
            <p className="text-xs mb-3" style={{ color: 'var(--text-error, #ef4444)' }}>{error}</p>
          )}

          {/* Progress bar */}
          {downloading && (
            <div className="mb-3">
              <div
                className="h-1.5 rounded overflow-hidden"
                style={{ backgroundColor: 'var(--bg-inset)' }}
              >
                <div
                  className="h-full transition-all duration-300"
                  style={{ width: `${progress}%`, backgroundColor: 'var(--accent-color)' }}
                />
              </div>
              <p className="text-xs mt-1 text-center" style={{ color: 'var(--text-tertiary)' }}>
                {progress}%
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={installUpdate}
              disabled={downloading}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium rounded transition-colors text-white"
              style={{
                backgroundColor: 'var(--accent-color)',
                opacity: downloading ? 0.7 : 1,
              }}
            >
              {downloading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Install Now
                </>
              )}
            </button>
            {!downloading && (
              <button
                onClick={dismiss}
                className="px-3 py-1.5 text-sm rounded transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                Later
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
